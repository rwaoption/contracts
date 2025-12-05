// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AuctionPricePredictionMarket
 * @notice Multi-price yes/no markets for NFT (RWA) auctions using CHAI. Multiple NFTs can be hosted; each NFT has
 * its own closeTime and finalAuctionPrice. Users bet CHAI on yes/no; payout splits the combined pool pro-rata to winners.
 */
contract AuctionPricePredictionMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Outcome {
        Undecided,
        Yes,
        No
    }

    struct Market {
        uint256 priceTarget;
        address nftAsset;
        Outcome outcome;
        uint256 yesShares;
        uint256 noShares;
        uint256 yesStake; // CHAI pool
        uint256 noStake;
    }

    struct AuctionConfig {
        uint64 closeTime;
        uint256 finalAuctionPrice;
        bool finalPriceSet;
    }

    uint256 private constant PRICE_SCALE = 1e18; // price/probability scale (1e18 = 100%)

    IERC20 public immutable chai;
    uint256 public immutable minStake;
    uint256 public marketCount;

    mapping(uint256 => Market) public markets;
    mapping(address => uint256[]) private _marketIdsByNFT;
    mapping(address => AuctionConfig) public auctions; // nft => auction config
    mapping(uint256 => mapping(address => uint256)) public yesSharesOf;
    mapping(uint256 => mapping(address => uint256)) public noSharesOf;
    mapping(uint256 => mapping(address => bool)) public claimed;

    error MarketClosed();
    error MarketResolved(uint256 marketId);
    error InvalidShareCount();
    error InvalidOutcome();
    error NothingToClaim();
    error AlreadyClaimed();
    error BeforeClose();
    error PriceNotSet();
    error MarketNotFound();
    error FinalPriceAlreadySet();
    error CloseTimeInPast();
    error AuctionNotConfigured();
    error Slippage();

    event AuctionConfigured(address indexed nft, uint64 closeTime);
    event MarketCreated(uint256 indexed marketId, address indexed nft, uint256 priceTarget);
    event FinalPriceSet(address indexed nft, uint256 finalAuctionPrice);
    event Buy(uint256 indexed marketId, address indexed buyer, bool indexed isYes, uint256 sharesOut, uint256 amountIn);
    event Resolved(uint256 indexed marketId, Outcome outcome);
    event Claimed(uint256 indexed marketId, address indexed account, uint256 payout);

    constructor(address chaiToken, uint256 minStake_) Ownable(msg.sender) {
        require(chaiToken != address(0), "CHAI token required");
        require(minStake_ > 0, "min stake must be > 0");

        chai = IERC20(chaiToken);
        minStake = minStake_;
    }

    /**
     * @notice Configure an auction deadline for a specific NFT (one-time).
     */
    function configureAuction(address nft, uint64 closeTime) external onlyOwner {
        if (nft == address(0)) revert AuctionNotConfigured();
        AuctionConfig storage auction = auctions[nft];
        if (auction.closeTime != 0) revert FinalPriceAlreadySet();
        if (closeTime <= block.timestamp) revert CloseTimeInPast();
        auction.closeTime = closeTime;
        emit AuctionConfigured(nft, closeTime);
    }

    /**
     * @notice Create a new price target market for a given NFT. Owner-only to coordinate auctions.
     * @param nft NFT address
     * @param priceTarget target price to compare against final auction price
     * @dev Must be created before the NFT's closeTime.
     */
    function createMarket(address nft, uint256 priceTarget) external onlyOwner returns (uint256 marketId) {
        AuctionConfig memory auction = auctions[nft];
        if (auction.closeTime == 0) revert AuctionNotConfigured();
        if (block.timestamp >= auction.closeTime) revert CloseTimeInPast();
        marketId = ++marketCount;
        markets[marketId] = Market({
            priceTarget: priceTarget,
            nftAsset: nft,
            outcome: Outcome.Undecided,
            yesShares: 0,
            noShares: 0,
            yesStake: 0,
            noStake: 0
        });
        _marketIdsByNFT[nft].push(marketId);
        emit MarketCreated(marketId, nft, priceTarget);
    }

    /**
     * @notice Buy yes with linear slippage pricing.
     * @param marketId market id
     * @param amountIn CHAI amount in
     * @param minSharesOut minimum acceptable shares (slippage protection, 1e18 scale)
     */
    function buyYes(uint256 marketId, uint256 amountIn, uint256 minSharesOut) external nonReentrant {
        _buy(marketId, true, amountIn, minSharesOut);
    }

    /**
     * @notice Buy no with linear slippage pricing.
     * @param marketId market id
     * @param amountIn CHAI amount in
     * @param minSharesOut minimum acceptable shares (slippage protection, 1e18 scale)
     */
    function buyNo(uint256 marketId, uint256 amountIn, uint256 minSharesOut) external nonReentrant {
        _buy(marketId, false, amountIn, minSharesOut);
    }

    /**
     * @notice Set final auction price for a specific NFT (one-time).
     */
    function setFinalAuctionPrice(address nft, uint256 finalPrice) external onlyOwner {
        AuctionConfig storage auction = auctions[nft];
        if (auction.closeTime == 0) revert AuctionNotConfigured();
        if (auction.finalPriceSet) revert FinalPriceAlreadySet();
        if (block.timestamp < auction.closeTime) revert BeforeClose();

        auction.finalPriceSet = true;
        auction.finalAuctionPrice = finalPrice;
        emit FinalPriceSet(nft, finalPrice);
    }

    /**
     * @notice Claim winnings once the market is resolved.
     * Winners receive their stake plus a pro-rata share of the losing pool.
     */
    function claim(uint256 marketId) external nonReentrant returns (uint256 payout) {
        Market storage market = markets[marketId];
        Outcome resolved = market.outcome;
        if (resolved == Outcome.Undecided) revert InvalidOutcome();
        if (claimed[marketId][msg.sender]) revert AlreadyClaimed();

        uint256 winnerShares = resolved == Outcome.Yes ? yesSharesOf[marketId][msg.sender] : noSharesOf[marketId][msg.sender];
        if (winnerShares == 0) revert NothingToClaim();

        claimed[marketId][msg.sender] = true;

        uint256 totalWinningShares = resolved == Outcome.Yes ? market.yesShares : market.noShares;
        uint256 totalPool = market.yesStake + market.noStake;
        payout = (winnerShares * totalPool) / totalWinningShares;

        chai.safeTransfer(msg.sender, payout);
        emit Claimed(marketId, msg.sender, payout);
    }

    function _buy(uint256 marketId, bool isYes, uint256 amountIn, uint256 minSharesOut) internal {
        if (amountIn == 0) revert InvalidShareCount();
        if (amountIn < minStake) revert InvalidShareCount();
        Market storage market = markets[marketId];
        if (market.nftAsset == address(0)) revert MarketNotFound();
        AuctionConfig storage auction = auctions[market.nftAsset];
        if (market.outcome != Outcome.Undecided) revert MarketResolved(marketId);
        if (block.timestamp >= auction.closeTime) revert MarketClosed();

        uint256 yesStake = market.yesStake;
        uint256 noStake = market.noStake;
        (uint256 sharesOut, uint256 postYes) = _calcSharesOut(yesStake, noStake, isYes, amountIn);
        if (sharesOut < minSharesOut) revert Slippage();

        chai.safeTransferFrom(msg.sender, address(this), amountIn);

        if (isYes) {
            market.yesStake = postYes;
            market.yesShares += sharesOut;
            yesSharesOf[marketId][msg.sender] += sharesOut;
        } else {
            market.noStake = noStake + amountIn;
            market.noShares += sharesOut;
            noSharesOf[marketId][msg.sender] += sharesOut;
        }

        emit Buy(marketId, msg.sender, isYes, sharesOut, amountIn);
    }

    /**
     * @notice Resolve a single market using the already-set final auction price.
     */
    function resolve(uint256 marketId) external onlyOwner {
        _resolveMarket(marketId);
    }

    /**
     * @notice Resolve all markets tied to an NFT. Requires final price set and past closeTime.
     */
    function resolveAllForNFT(address nft) external onlyOwner {
        AuctionConfig memory auction = auctions[nft];
        if (auction.closeTime == 0) revert AuctionNotConfigured();
        if (block.timestamp < auction.closeTime) revert BeforeClose();
        if (!auction.finalPriceSet) revert PriceNotSet();

        uint256 finalPrice = auction.finalAuctionPrice;
        uint256[] memory ids = _marketIdsByNFT[nft];
        uint256 total = ids.length;
        for (uint256 i = 0; i < total; i++) {
            uint256 marketId = ids[i];
            Market storage market = markets[marketId];
            if (market.outcome != Outcome.Undecided) continue;
            market.outcome = finalPrice >= market.priceTarget ? Outcome.Yes : Outcome.No;
            emit Resolved(marketId, market.outcome);
        }
    }

    function _resolveMarket(uint256 marketId) internal {
        Market storage market = markets[marketId];
        if (market.nftAsset == address(0)) revert MarketNotFound();
        AuctionConfig memory auction = auctions[market.nftAsset];
        if (market.outcome != Outcome.Undecided) revert MarketResolved(marketId);
        if (block.timestamp < auction.closeTime) revert BeforeClose();
        if (!auction.finalPriceSet) revert PriceNotSet();

        market.outcome = auction.finalAuctionPrice >= market.priceTarget ? Outcome.Yes : Outcome.No;
        emit Resolved(marketId, market.outcome);
    }

    /**
     * @notice Get all market IDs for an NFT.
     */
    function getMarketIdsForNFT(address nft) external view returns (uint256[] memory) {
        return _marketIdsByNFT[nft];
    }

    /**
     * @notice Return current yes/no price as pool ratios (1e18 scale).
     * @return yesPrice  yes ratio (1e18 = 100%)
     * @return noPrice   no ratio (1e18 = 100%)
     */
    function getQuote(uint256 marketId) external view returns (uint256 yesPrice, uint256 noPrice) {
        Market memory market = markets[marketId];
        if (market.nftAsset == address(0)) revert MarketNotFound();
        uint256 yesStake = market.yesStake;
        uint256 noStake = market.noStake;
        uint256 total = yesStake + noStake;
        if (total == 0) {
            return (0, 0);
        }
        yesPrice = (yesStake * PRICE_SCALE) / total;
        noPrice = PRICE_SCALE - yesPrice;
    }

    function _calcSharesOut(uint256 yesStake, uint256 noStake, bool isYes, uint256 amountIn) private pure returns (uint256 sharesOut, uint256 postYes) {
        uint256 totalStake = yesStake + noStake;
        uint256 p0 = totalStake == 0 ? PRICE_SCALE / 2 : (yesStake * PRICE_SCALE) / totalStake;
        postYes = isYes ? yesStake + amountIn : yesStake;
        uint256 p1 = (postYes * PRICE_SCALE) / (totalStake + amountIn);
        uint256 pAvg = (p0 + p1) / 2;
        sharesOut = (amountIn * PRICE_SCALE) / pAvg;
    }
}
