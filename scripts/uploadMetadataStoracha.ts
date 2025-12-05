import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";
import { File } from "web3.storage";

dotenv.config();

async function main() {
  const email = process.env.STORACHA_EMAIL;
  if (!email) {
    throw new Error("Set STORACHA_EMAIL in your environment for login.");
  }

  const [, , metadataPathArg] = process.argv;
  if (!metadataPathArg) {
    throw new Error("Usage: npx ts-node scripts/uploadMetadataStoracha.ts metadata/chaiyao.json");
  }

  const configDir = path.join(process.cwd(), ".storacha");
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  process.env.XDG_CONFIG_HOME = configDir;
  process.env.XDG_DATA_HOME = configDir;
  const homeDir = path.join(process.cwd(), ".storacha_home");
  if (!fs.existsSync(homeDir)) {
    fs.mkdirSync(homeDir, { recursive: true });
  }
  (os as any).homedir = () => homeDir; // force homedir for conf/env-paths consumers
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.HOMEPATH = homeDir;

  const { create } = await import("@storacha/client"); // import after homedir override
  const client = await create();

  // Login triggers an email confirmation; user must click the link before this resolves.
  const account = await client.login(email);
  await account.plan.wait(); // waits for payment plan selection if required

  // If no current space, create one. Otherwise, reuse the current space.
  const existing = await client.currentSpace();
  let space = existing;
  if (!space) {
    space = await client.createSpace(process.env.STORACHA_SPACE_NAME || "chaiyao-space", { account });
  }
  if (!space) {
    throw new Error("Failed to initialize Storacha space");
  }
  if (!existing) {
    await client.setCurrentSpace(space.did());
  }

  const data = fs.readFileSync(metadataPathArg);
  const file = new File([data], path.basename(metadataPathArg));
  const cid = await client.uploadFile(file);
  console.log("Uploaded via Storacha");
  console.log("CID:", cid);
  console.log("URI:", `ipfs://${cid}`);
  console.log(`Gateway: https://${cid}.ipfs.storacha.link`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
