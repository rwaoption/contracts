import fs from "fs";
import path from "path";
import { ethers, network } from "hardhat";

type AbiArg = { types: string[]; values: unknown[] };

function getLatestBuildInfoPath(): string {
  const dir = path.join(__dirname, "..", "artifacts", "build-info");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (!files.length) throw new Error("No build-info found. Run `npx hardhat compile` first.");
  const sorted = files
    .map((f) => ({ file: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return path.join(dir, sorted[0].file);
}

function loadStdInput(): { sourceCode: string; compilerVersion: string; optimizer: { enabled: boolean; runs: number } } {
  const buildInfoPath = getLatestBuildInfoPath();
  const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
  const input = buildInfo.input;
  const sourceCode = JSON.stringify(input);
  const version: string = buildInfo.solcLongVersion || buildInfo.solcVersion;
  const optimizer = {
    enabled: !!input.settings?.optimizer?.enabled,
    runs: input.settings?.optimizer?.runs ?? 200,
  };
  return { sourceCode, compilerVersion: version.startsWith("v") ? version : `v${version}`, optimizer };
}

function encodeConstructorArgs(arg: AbiArg | null): string {
  if (!arg) return "";
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

  // Allow indexer to catch up.
  await new Promise((resolve) => setTimeout(resolve, 15_000));

  const { sourceCode, compilerVersion, optimizer } = loadStdInput();
  const constructorArguements = encodeConstructorArgs(params.constructorArgs ?? null); // Note: API expects hex without 0x

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
    console.log("Verify response:", json);
    if (json.status === "1") {
      console.log(`✓ Submitted for verification. GUID: ${json.result}`);
    } else {
      console.log(`⚠️ Verification submission failed: ${json.message} (${json.result})`);
    }
  } catch (err: any) {
    console.log(`⚠️ NodeReal verify request failed: ${err?.message ?? err}`);
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name);

  // Deploy NFT
  const nftFactory = await ethers.getContractFactory("ChaiYaoNFT");
  const baseURI = "ipfs://chai-yao/";
  const nft = await nftFactory.deploy(baseURI);
  await nft.waitForDeployment();
  const nftAddress = await nft.getAddress();
  console.log("ChaiYaoNFT deployed at:", nftAddress);

  // Deploy ERC20 fragments (requires NFT address)
  const tokenFactory = await ethers.getContractFactory("CHAIToken");
  const token = await tokenFactory.deploy(nftAddress);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("CHAIToken deployed at:", tokenAddress);

  // Deploy prediction market (minStake configurable here).
  const marketFactory = await ethers.getContractFactory("AuctionPricePredictionMarket");
  const minStake = ethers.parseEther("0.01");
  const market = await marketFactory.deploy(tokenAddress, minStake);
  await market.waitForDeployment();
  const marketAddress = await market.getAddress();
  console.log("AuctionPricePredictionMarket deployed at:", marketAddress);

  // (Optional) configure an auction for the freshly deployed NFT.
  const closeTime = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // now + 7 days
  const configTx = await market.configureAuction(nftAddress, closeTime);
  await configTx.wait();
  console.log(`Auction configured for NFT ${nftAddress} with closeTime ${closeTime}`);

  // Link fragment token on NFT (one-time)
  const linkTx = await nft.setFragmentToken(tokenAddress);
  await linkTx.wait();
  console.log("Fragment token linked on NFT.");

  // Optional: verify contracts via NodeReal API (standard-json-input, no flatten).
  await verifyViaNodeReal({
    contractAddress: nftAddress,
    contractName: "ChaiYaoNFT",
    sourceName: "contracts/ChaiYaoNFT.sol",
    constructorArgs: { types: ["string"], values: [baseURI] },
  });

  await verifyViaNodeReal({
    contractAddress: tokenAddress,
    contractName: "CHAIToken",
    sourceName: "contracts/CHAIToken.sol",
    constructorArgs: { types: ["address"], values: [nftAddress] },
  });

  await verifyViaNodeReal({
    contractAddress: marketAddress,
    contractName: "AuctionPricePredictionMarket",
    sourceName: "contracts/AuctionPricePredictionMarket.sol",
    constructorArgs: { types: ["address", "uint256"], values: [tokenAddress, minStake] },
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
