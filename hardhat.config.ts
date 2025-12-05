import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const OPBNB_TESTNET_RPC = process.env.OPBNB_TESTNET_RPC || "https://opbnb-testnet-rpc.bnbchain.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.DEPLOYER_KEY || "";

const config: HardhatUserConfig = {
  solidity: "0.8.21",
  paths: {
    tests: "tests",
  },
  networks: {
    opbnbTestnet: {
      url: OPBNB_TESTNET_RPC,
      chainId: 5611,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};

export default config;
