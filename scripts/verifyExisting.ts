import "dotenv/config";
import fs from "fs";
import path from "path";
import { network } from "hardhat";

type AbiArg = { types: string[]; values: unknown[] };

function findBuildInfoWithSource(sourceName: string) {
  const dir = path.join(__dirname, "..", "artifacts", "build-info");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (!files.length) throw new Error("No build-info found. Run `npx hardhat compile` first.");

  const sorted = files
    .map((f) => ({ file: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const { file } of sorted) {
    const full = path.join(dir, file);
    const buildInfo = JSON.parse(fs.readFileSync(full, "utf8"));
    if (buildInfo.input?.sources?.[sourceName]) {
      const input = buildInfo.input;
      const sourceCode = JSON.stringify(input);
      const version: string = buildInfo.solcLongVersion || buildInfo.solcVersion;
      const optimizer = {
        enabled: !!input.settings?.optimizer?.enabled,
        runs: input.settings?.optimizer?.runs ?? 200,
      };
      return { sourceCode, compilerVersion: version.startsWith("v") ? version : `v${version}`, optimizer };
    }
  }
  throw new Error(`No build-info contains source ${sourceName}. Try \`npx hardhat compile --force\`.`);
}

function encodeConstructorArgs(arg: AbiArg | null): string {
  if (!arg) return "";
  const { ethers } = require("hardhat");
  const coder = ethers.AbiCoder.defaultAbiCoder();
  return coder.encode(arg.types, arg.values).slice(2);
}

async function verifyViaNodeReal(params: {
  contractAddress: string;
  contractName: string; // e.g., ChaiYaoNFT
  sourceName: string; // e.g., contracts/ChaiYaoNFT.sol
  constructorArgs?: AbiArg | null;
}) {
  const apiKey = process.env.NODEREAL_API_KEY;
  if (!apiKey) {
    console.log("↪︎ Skip verify: set NODEREAL_API_KEY to enable NodeReal verification.");
    return;
  }

  const networkSlug = network.name === "opbnbTestnet" ? "op-bnb-testnet" : network.name === "opbnb" ? "op-bnb-mainnet" : "";
  if (!networkSlug) {
    console.log(`↪︎ Skip verify: unsupported network ${network.name} for NodeReal path.`);
    return;
  }

  const { sourceCode, compilerVersion, optimizer } = findBuildInfoWithSource(params.sourceName);
  const constructorArguements = encodeConstructorArgs(params.constructorArgs ?? null);

  const form = new URLSearchParams();
  form.set("action", "verifysourcecode");
  form.set("contractaddress", params.contractAddress);
  form.set("sourceCode", sourceCode);
  form.set("codeformat", "solidity-standard-json-input");
  form.set("contractname", `${params.sourceName}:${params.contractName}`);
  form.set("compilerversion", compilerVersion);
  form.set("optimizationUsed", optimizer.enabled ? "1" : "0");
  form.set("runs", optimizer.runs.toString());
  form.set("constructorArguements", constructorArguements);
  form.set("licenseType", "3"); // MIT

  const url = `https://open-platform.nodereal.io/${apiKey}/${networkSlug}/contract`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const json = await res.json();
    console.log(`Verify submit (${params.contractName}):`, json);
  } catch (err: any) {
    console.log(`⚠️ NodeReal verify request failed for ${params.contractName}: ${err?.message ?? err}`);
  }
}

async function main() {
  const nft = process.env.CHAIYAO_NFT_ADDRESS;
  const chai = process.env.CHAI_TOKEN_ADDRESS;
  const market = process.env.AUCTION_PRICE_PREDICTION_MARKET_ADDRESS;
  if (!nft || !chai || !market) throw new Error("Missing contract addresses in .env");

  console.log("Network:", network.name);
  console.log("NFT:", nft);
  console.log("CHAI:", chai);
  console.log("Market:", market);

  await verifyViaNodeReal({
    contractAddress: nft,
    contractName: "ChaiYaoNFT",
    sourceName: "contracts/ChaiYaoNFT.sol",
    constructorArgs: { types: ["string"], values: ["ipfs://chai-yao/"] }, // adjust if baseURI changed
  });

  await verifyViaNodeReal({
    contractAddress: chai,
    contractName: "CHAIToken",
    sourceName: "contracts/CHAIToken.sol",
    constructorArgs: { types: ["address"], values: [nft] },
  });

  await verifyViaNodeReal({
    contractAddress: market,
    contractName: "AuctionPricePredictionMarket",
    sourceName: "contracts/AuctionPricePredictionMarket.sol",
    constructorArgs: { types: ["address", "uint256"], values: [chai, process.env.MIN_STAKE ?? ethers.parseEther("0.01")] },
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
