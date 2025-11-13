const contractPerNetwork = {
  mainnet: "social.near",
  testnet: "v1.social08.testnet",
} as const;

type NetworkId = keyof typeof contractPerNetwork;

const networkSettings = {
  mainnet: {
    rpcUrl: "https://rpc.fastnear.com",
  },
  testnet: {
    rpcUrl: "https://test.rpc.fastnear.com",
  },
} as const;

// Chains for EVM Wallets
const evmWalletChains = {
  mainnet: {
    chainId: 397,
    name: "Near Mainnet",
    explorer: "https://eth-explorer.near.org",
    rpc: "https://eth-rpc.mainnet.near.org",
  },
  testnet: {
    chainId: 398,
    name: "Near Testnet",
    explorer: "https://eth-explorer-testnet.near.org",
    rpc: "https://eth-rpc.testnet.near.org",
  },
} as const;

const runtimeNetworkId: NetworkId =
  process.env.NODE_ENV === "production" ? "mainnet" : "testnet";

export const nearConfig = {
  networkId: runtimeNetworkId,
  socialContract: contractPerNetwork[runtimeNetworkId],
  evmWalletChain: evmWalletChains[runtimeNetworkId],
  rpcUrl: networkSettings[runtimeNetworkId].rpcUrl,
};

export const SocialContract = nearConfig.socialContract;
export const EVMWalletChain = nearConfig.evmWalletChain;
