import "dotenv/config";
import { ethers, network } from "hardhat";

/**
 * Deploy only AuctionPricePredictionMarket using existing CHAI token.
 *
 * ENV:
 *  - PRIVATE_KEY (deployer)
 *  - CHAI_TOKEN_ADDRESS
 *  - CHAIYAO_NFT_ADDRESS (for initial configureAuction)
 *  - MIN_STAKE (optional, default 0.01 CHAI)
 */

async function main() {
  const { PRIVATE_KEY, CHAI_TOKEN_ADDRESS, CHAIYAO_NFT_ADDRESS, MIN_STAKE } = process.env;
  if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY in .env");
  if (!CHAI_TOKEN_ADDRESS) throw new Error("Missing CHAI_TOKEN_ADDRESS in .env");
  if (!CHAIYAO_NFT_ADDRESS) throw new Error("Missing CHAIYAO_NFT_ADDRESS in .env");

  const provider = ethers.provider;
  const deployer = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("CHAI:", CHAI_TOKEN_ADDRESS);

  const minStake = MIN_STAKE ? BigInt(MIN_STAKE) : ethers.parseEther("0.01");
  console.log("minStake:", minStake.toString());

  const factory = await ethers.getContractFactory("AuctionPricePredictionMarket", deployer);
  const market = await factory.deploy(CHAI_TOKEN_ADDRESS, minStake);
  await market.waitForDeployment();
  const marketAddr = await market.getAddress();
  console.log("AuctionPricePredictionMarket deployed at:", marketAddr);

  // Configure auction for the provided NFT with closeTime = now + 7 days.
  const closeTime = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
  const cfg = await market.configureAuction(CHAIYAO_NFT_ADDRESS, closeTime);
  await cfg.wait();
  console.log(`configureAuction done for NFT ${CHAIYAO_NFT_ADDRESS}, closeTime=${closeTime}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
