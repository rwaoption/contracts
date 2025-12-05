import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

describe("AuctionPricePredictionMarket", () => {
  async function deployFixture() {
    const [owner, user, user2] = await ethers.getSigners();

    const ChaiYaoNFT = await ethers.getContractFactory("ChaiYaoNFT");
    const nft = await ChaiYaoNFT.deploy("https://base/");

    const CHAI = await ethers.getContractFactory("CHAIToken");
    const chai = await CHAI.deploy(await nft.getAddress());

    const Market = await ethers.getContractFactory("AuctionPricePredictionMarket");
    const minStake = ethers.parseEther("0.01");
    const market = await Market.deploy(await chai.getAddress(), minStake);

    const closeTime = (await time.latest()) + 3600;
    await market.configureAuction(await nft.getAddress(), closeTime);
    await market.createMarket(await nft.getAddress(), ethers.parseEther("10"));
    await market.createMarket(await nft.getAddress(), ethers.parseEther("20"));
    const marketId1 = 1n;
    const marketId2 = 2n;

    return { owner, user, user2, nft, chai, market, marketId1, marketId2, closeTime, minStake };
  }

  it("allows buys with linear pricing and updates stakes/shares", async () => {
    const { market, marketId1: marketId, chai, user, minStake } = await loadFixture(deployFixture);
    const amountIn = ethers.parseEther("1");

    await chai.transfer(user.address, amountIn * 2n);
    await chai.connect(user).approve(await market.getAddress(), amountIn * 2n);

    const tx = await market.connect(user).buyYes(marketId, amountIn, 0);
    await expect(tx).to.emit(market, "Buy");

    const info = await market.markets(marketId);
    expect(info.yesStake).to.equal(amountIn);
    expect(info.noStake).to.equal(0);
    expect(info.yesShares).to.be.gt(amountIn); // due to avg price < 1

    // price should move toward yes
    const quote = await market.getQuote(marketId);
    expect(quote[0]).to.be.gt(quote[1]);

    // cannot buy below minStake
    await expect(market.connect(user).buyNo(marketId, minStake - 1n, 0)).to.be.revertedWithCustomError(
      market,
      "InvalidShareCount",
    );
  });

  it("enforces slippage protection", async () => {
    const { market, marketId1: marketId, chai, user } = await loadFixture(deployFixture);
    const amountIn = ethers.parseEther("1");

    await chai.transfer(user.address, amountIn);
    await chai.connect(user).approve(await market.getAddress(), amountIn);

    const minSharesOut = ethers.parseEther("2"); // deliberately too high
    await expect(market.connect(user).buyYes(marketId, amountIn, minSharesOut)).to.be.revertedWithCustomError(
      market,
      "Slippage",
    );
  });

  it("pays winners pro-rata from total pool after resolve", async () => {
    const { market, marketId1: marketId, chai, user, user2, closeTime, nft } = await loadFixture(deployFixture);
    const amountIn = ethers.parseEther("1");

    // seed balances and approvals
    await chai.transfer(user.address, amountIn);
    await chai.transfer(user2.address, amountIn);
    await chai.connect(user).approve(await market.getAddress(), amountIn);
    await chai.connect(user2).approve(await market.getAddress(), amountIn);

    // yes vs no
    await market.connect(user).buyYes(marketId, amountIn, 0);
    await market.connect(user2).buyNo(marketId, amountIn, 0);

    // move past closeTime and set final price favoring yes
    await time.increaseTo(closeTime + 1);
    await market.setFinalAuctionPrice(await nft.getAddress(), ethers.parseEther("20"));
    await market.resolve(marketId);

    const poolBefore = await chai.balanceOf(await market.getAddress());
    await expect(market.connect(user).claim(marketId)).to.emit(market, "Claimed");
    const poolAfter = await chai.balanceOf(await market.getAddress());

    // yes side takes the entire pool (no claim left for no)
    expect(poolAfter).to.equal(0);
    expect(poolBefore).to.be.gt(0);
    await expect(market.connect(user2).claim(marketId)).to.be.revertedWithCustomError(market, "NothingToClaim");
  });

  it("resolveAllForNFT settles all undecided markets for that NFT", async () => {
    const { market, marketId1, marketId2, chai, user, closeTime, nft } = await loadFixture(deployFixture);
    const amountIn = ethers.parseEther("1");

    await chai.transfer(user.address, amountIn * 2n);
    await chai.connect(user).approve(await market.getAddress(), amountIn * 2n);

    await market.connect(user).buyYes(marketId1, amountIn, 0);
    await market.connect(user).buyYes(marketId2, amountIn, 0);

    await time.increaseTo(closeTime + 1);
    await market.setFinalAuctionPrice(await nft.getAddress(), ethers.parseEther("30"));
    await market.resolveAllForNFT(await nft.getAddress());

    const state1 = await market.markets(marketId1);
    const state2 = await market.markets(marketId2);
    expect(state1.outcome).to.equal(1); // Yes
    expect(state2.outcome).to.equal(1); // Yes
  });
});
