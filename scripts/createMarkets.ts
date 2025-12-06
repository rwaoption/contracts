import "dotenv/config";
import { ethers } from "hardhat";

/**
 * Create three markets with target prices 600000000, 500000000, 300000000
 * against the configured NFT on AuctionPricePredictionMarket.
 *
 * ENV required:
 *  - PRIVATE_KEY (owner/deployer)
 *  - CHAIYAO_NFT_ADDRESS
 *  - AUCTION_PRICE_PREDICTION_MARKET_ADDRESS
 */

async function main() {
  const { PRIVATE_KEY, CHAIYAO_NFT_ADDRESS, AUCTION_PRICE_PREDICTION_MARKET_ADDRESS } = process.env;
  if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY in .env");
  if (!CHAIYAO_NFT_ADDRESS || !AUCTION_PRICE_PREDICTION_MARKET_ADDRESS)
    throw new Error("Missing CHAIYAO_NFT_ADDRESS or AUCTION_PRICE_PREDICTION_MARKET_ADDRESS");

  const provider = ethers.provider;
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log("Network:", (await provider.getNetwork()).name, (await provider.getNetwork()).chainId);
  console.log("Signer:", signer.address);

  const market = await ethers.getContractAt(
    "AuctionPricePredictionMarket",
    AUCTION_PRICE_PREDICTION_MARKET_ADDRESS,
    signer,
  );

  const targets = [600_000_000n, 500_000_000n, 300_000_000n];

  for (const t of targets) {
    console.log(`Creating market for NFT ${CHAIYAO_NFT_ADDRESS} with target ${t}...`);
    const tx = await market.createMarket(CHAIYAO_NFT_ADDRESS, t);
    const receipt = await tx.wait();
    const event = receipt?.logs?.find((l) => (l as any).fragment?.name === "MarketCreated");
    const marketId = event ? (event as any).args?.marketId ?? (event as any).args?.[0] : await market.marketCount();
    console.log(`✓ Created marketId=${marketId?.toString()} target=${t}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
