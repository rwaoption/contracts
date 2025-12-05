import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { Web3Storage, File } from "web3.storage";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const token = process.env.WEB3_STORAGE_TOKEN;
  if (!token) {
    throw new Error("Set WEB3_STORAGE_TOKEN in your environment.");
  }

  const [, , metadataPathArg] = process.argv;
  if (!metadataPathArg) {
    throw new Error("Usage: npx ts-node scripts/uploadMetadata.ts metadata/chaiyao.json");
  }

  const metadataPath = path.resolve(metadataPathArg);
  const data = fs.readFileSync(metadataPath);
  const fileName = path.basename(metadataPath);

  const endpointEnv = process.env.WEB3_STORAGE_ENDPOINT;
  const client = new Web3Storage({
    token,
    endpoint: endpointEnv ? new URL(endpointEnv) : undefined, // e.g. https://api.nft.storage for fallback
  });
  const files = [new File([data], fileName)];

  try {
    const cid = await client.put(files, { wrapWithDirectory: false });
    console.log("Uploaded to IPFS via Web3.Storage");
    console.log("CID:", cid);
    console.log("URI:", `ipfs://${cid}`);
    return;
  } catch (err: any) {
    console.warn("Web3.Storage put failed, trying direct upload...", err?.message ?? err);
  }

  // Fallback: direct HTTP upload to /upload (compatible with NFT.Storage/Web3.Storage APIs)
  const uploadUrl = (endpointEnv || "https://api.web3.storage") + "/upload";
  try {
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: data,
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      throw new Error(`Upload failed: ${res.status} ${res.statusText} ${JSON.stringify(json)}`);
    }
    const cid = json.value.cid;
    console.log("Uploaded via direct HTTP");
    console.log("CID:", cid);
    console.log("URI:", `ipfs://${cid}`);
  } catch (err: any) {
    console.error("Direct upload also failed:", err?.message ?? err);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
