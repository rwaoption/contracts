import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("CHAIToken", () => {
  async function deployFixture() {
    const [owner, user] = await ethers.getSigners();
    const nftFactory = await ethers.getContractFactory("ChaiYaoNFT");
    const nft = await nftFactory.deploy("ipfs://chai-yao/");
    await nft.waitForDeployment();

    const factory = await ethers.getContractFactory("CHAIToken");
    const token = await factory.deploy(await nft.getAddress());
    await token.waitForDeployment();
    return { token, nft, owner, user };
  }

  it("deploys with correct name, symbol, and total supply", async () => {
    const { token, nft, owner } = await loadFixture(deployFixture);
    expect(await token.name()).to.equal("ChaiYao Fractional Token");
    expect(await token.symbol()).to.equal("CHAI");
    expect(await token.decimals()).to.equal(18);
    expect(await token.chaiYaoNFT()).to.equal(await nft.getAddress());

    const supply = 1_000_000_000n * 10n ** 18n;
    expect(await token.totalSupply()).to.equal(supply);
    expect(await token.balanceOf(owner.address)).to.equal(supply);
  });

  it("transfers between accounts", async () => {
    const { token, owner, user } = await loadFixture(deployFixture);
    const amount = 1000n * 10n ** 18n;
    await expect(token.transfer(user.address, amount))
      .to.emit(token, "Transfer")
      .withArgs(owner.address, user.address, amount);

    expect(await token.balanceOf(user.address)).to.equal(amount);
  });

  it("has no mint functionality beyond fixed supply", async () => {
    const { token } = await loadFixture(deployFixture);
    // Calling an undefined function should revert; this protects against accidental assumptions of extra minting.
    const fakeMintSig = "0x40c10f19"; // standard mint(address,uint256) selector
    await expect(
      ethers.provider.send("eth_sendTransaction", [
        {
          to: await token.getAddress(),
          from: (await ethers.getSigners())[0].address,
          data: fakeMintSig,
        },
      ])
    ).to.be.reverted;
  });

  it("reverts deployment with zero NFT address", async () => {
    const factory = await ethers.getContractFactory("CHAIToken");
    await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWith("NFT address required");
  });
});
