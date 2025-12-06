import "dotenv/config";
import { ethers } from "hardhat";

/**
 * Run a minimal end-to-end flow on opbnbTestnet (or configured network) WITHOUT resolve/settlement:
 * - Reads deployed addresses from .env
 * - Uses three accounts: deployer (PRIVATE_KEY), user2 (PRIVATE_KEY_2), user3 (PRIVATE_KEY_3)
 * - Users approve CHAI and place buyYes/buyNo on a created market
 * - Skips resolve/final price to avoid altering state permanently
 *
 * ENV required:
 *  PRIVATE_KEY, PRIVATE_KEY_2, PRIVATE_KEY_3
 *  CHAI_TOKEN_ADDRESS, CHAIYAO_NFT_ADDRESS, AUCTION_PRICE_PREDICTION_MARKET_ADDRESS
 */

async function main() {
  const {
    PRIVATE_KEY,
    PRIVATE_KEY_2,
    PRIVATE_KEY_3,
    CHAI_TOKEN_ADDRESS,
    CHAIYAO_NFT_ADDRESS,
    AUCTION_PRICE_PREDICTION_MARKET_ADDRESS,
  } = process.env;

  if (!PRIVATE_KEY || !PRIVATE_KEY_2 || !PRIVATE_KEY_3) throw new Error("Missing PRIVATE_KEY* in .env");
  if (!CHAI_TOKEN_ADDRESS || !CHAIYAO_NFT_ADDRESS || !AUCTION_PRICE_PREDICTION_MARKET_ADDRESS) {
    throw new Error("Missing contract addresses in .env");
  }

  const provider = ethers.provider;
  const deployer = new ethers.Wallet(PRIVATE_KEY, provider);
  const user2 = new ethers.Wallet(PRIVATE_KEY_2, provider);
  const user3 = new ethers.Wallet(PRIVATE_KEY_3, provider);

  console.log("Network:", (await provider.getNetwork()).name, (await provider.getNetwork()).chainId);
  console.log("Deployer:", deployer.address);
  console.log("User2:", user2.address);
  console.log("User3:", user3.address);

  const chai = await ethers.getContractAt("CHAIToken", CHAI_TOKEN_ADDRESS, deployer);
  const market = await ethers.getContractAt(
    "AuctionPricePredictionMarket",
    AUCTION_PRICE_PREDICTION_MARKET_ADDRESS,
    deployer
  );

  const nftAddr = CHAIYAO_NFT_ADDRESS;

  // Ensure auction is configured
  const auctionCfg = await market.auctions(nftAddr);
  if (auctionCfg.closeTime === 0n) {
    const closeTime = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
    console.log(`Configuring auction for NFT ${nftAddr} with closeTime ${closeTime}...`);
    const tx = await market.connect(deployer).configureAuction(nftAddr, closeTime);
    await tx.wait();
  } else {
    console.log(`Auction already configured. closeTime=${auctionCfg.closeTime}, finalPriceSet=${auctionCfg.finalPriceSet}`);
  }

  // Create a market if none exists; otherwise use first market ID for this NFT.
  let marketId: bigint | undefined;
  const existingIds: bigint[] = await market.getMarketIdsForNFT(nftAddr);
  if (existingIds.length === 0) {
    const target = ethers.parseEther("10"); // sample price target
    console.log(`Creating market for NFT ${nftAddr} with target ${target}...`);
    const tx = await market.connect(deployer).createMarket(nftAddr, target);
    const receipt = await tx.wait();
    const event = receipt?.logs?.find((l) => (l as any).fragment?.name === "MarketCreated");
    if (event) {
      marketId = (event as any).args?.marketId ?? (event as any).args?.[0];
    } else {
      // fallback: assume last marketCount
      marketId = await market.marketCount();
    }
    console.log("Created marketId:", marketId?.toString());
  } else {
    marketId = existingIds[1];
    console.log("Using existing marketId:", marketId.toString());
  }

  // Fund user2 and user3 with CHAI from deployer if they have none.
  const minFund = ethers.parseEther("5");
  for (const [label, wallet] of [
    ["User2", user2],
    ["User3", user3],
  ]) {
    const bal = await chai.balanceOf(wallet.address);
    if (bal < minFund) {
      const topUp = minFund - bal;
      console.log(`${label} balance low (${bal}), transferring ${topUp} CHAI from deployer...`);
      const tx = await chai.connect(deployer).transfer(wallet.address, topUp);
      await tx.wait();
    } else {
      console.log(`${label} balance: ${bal}`);
    }

    // Ensure they have native gas (OPBNB) for approvals/tx
    const nativeNeeded = ethers.parseEther("0.002");
    const nativeBal = await provider.getBalance(wallet.address);
    if (nativeBal < nativeNeeded) {
      const topUp = nativeNeeded - nativeBal;
      console.log(`${label} native balance low (${nativeBal}), sending ${topUp} from deployer...`);
      const tx = await deployer.sendTransaction({ to: wallet.address, value: topUp });
      await tx.wait();
    } else {
      console.log(`${label} native balance: ${nativeBal}`);
    }
  }

  // Approve and place trades before closeTime
  const amountIn = ethers.parseEther("1");
  const approveAndBuy = async (wallet: ethers.Wallet, isYes: boolean, amt: bigint) => {
    const signerChai = chai.connect(wallet);
    const signerMarket = market.connect(wallet);
    const allowance = await signerChai.allowance(wallet.address, market.target);
    if (allowance < amt) {
      const tx = await signerChai.approve(market.target, amt);
      await tx.wait();
    }
    console.log(`${wallet.address} placing ${isYes ? "YES" : "NO"} on market ${marketId} amountIn=${amt}`);
    const tx = isYes ? await signerMarket.buyYes(marketId!, amt, 0) : await signerMarket.buyNo(marketId!, amt, 0);
    await tx.wait();
  };

  // Helper to log expected pricing for a hypothetical single-sided trade
  const previewTrade = async (isYes: boolean, amt: bigint) => {
    const info = await market.markets(marketId);
    const yesStake = info.yesStake;
    const noStake = info.noStake;
    const total = yesStake + noStake;
    const PRICE_SCALE = 10n ** 18n;
    const p0 = total === 0n ? PRICE_SCALE / 2n : (yesStake * PRICE_SCALE) / total;
    const postYes = isYes ? yesStake + amt : yesStake;
    const postTotal = total + amt;
    const p1 = (postYes * PRICE_SCALE) / postTotal;
    const pAvg = (p0 + p1) / 2n;
    const sharesOut = (amt * PRICE_SCALE) / pAvg;
    console.log(
      `Preview ${isYes ? "YES" : "NO"} amt=${amt} => p0=${p0} p1=${p1} pAvg=${pAvg} sharesOut=${sharesOut}`
    );
  };

  // Single-sided sequences to observe price impact
  const yesAmounts = [ethers.parseEther("1"), ethers.parseEther("2")];
  for (const amt of yesAmounts) {
    await previewTrade(true, amt);
    await approveAndBuy(user2, true, amt);
  }

  const noAmounts = [ethers.parseEther("1")];
  for (const amt of noAmounts) {
    await previewTrade(false, amt);
    await approveAndBuy(user3, false, amt);
  }

  // Show quotes and stakes
  const [yesPrice, noPrice] = await market.getQuote(marketId);
  const info = await market.markets(marketId);
  console.log(`Post-trade quote: yes=${yesPrice} no=${noPrice}`);
  console.log(
    `Pool stakes: yesStake=${info.yesStake.toString()} noStake=${info.noStake.toString()} yesShares=${info.yesShares.toString()} noShares=${info.noShares.toString()}`
  );

  console.log("Done. Resolve/settlement intentionally skipped.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
