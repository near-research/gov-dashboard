import { NEAR_MAINNET, NEAR_TESTNET, SIWN_RECIPIENT } from "@/constants/near";
import { logger } from "@/lib/logger";

const contractPerNetwork = {
  [NEAR_MAINNET]: SIWN_RECIPIENT,
  [NEAR_TESTNET]: "v1.social08.testnet",
} as const;

type NetworkId = keyof typeof contractPerNetwork;

const networkSettings = {
  [NEAR_MAINNET]: {
    rpcUrl: "https://rpc.fastnear.com",
  },
  [NEAR_TESTNET]: {
    rpcUrl: "https://test.rpc.fastnear.com",
  },
} as const;

// Chains for EVM Wallets
const evmWalletChains = {
  [NEAR_MAINNET]: {
    chainId: 397,
    name: "Near Mainnet",
    explorer: "https://eth-explorer.near.org",
    rpc: "https://eth-rpc.mainnet.near.org",
  },
  [NEAR_TESTNET]: {
    chainId: 398,
    name: "Near Testnet",
    explorer: "https://eth-explorer-testnet.near.org",
    rpc: "https://eth-rpc.testnet.near.org",
  },
} as const;

const envNetwork = (process.env.NEXT_PUBLIC_NEAR_NETWORK || "").toLowerCase();
const runtimeNetworkId: NetworkId =
  envNetwork === NEAR_MAINNET || envNetwork === NEAR_TESTNET
    ? (envNetwork as NetworkId)
    : process.env.NODE_ENV === "production"
      ? NEAR_MAINNET
      : NEAR_TESTNET;

const isDomainMainnet = () => {
  const domain = process.env.NEXT_PUBLIC_NEAR_DOMAIN || "";
  return domain.includes("near.org") && !domain.includes(NEAR_TESTNET);
};

if (typeof console !== "undefined") {
  if (runtimeNetworkId === NEAR_TESTNET && isDomainMainnet()) {
    logger.warn(
      "[nearConfig] Network is testnet but domain looks mainnet. Check NEXT_PUBLIC_NEAR_NETWORK / NEXT_PUBLIC_NEAR_DOMAIN."
    );
  }
  if (runtimeNetworkId === NEAR_MAINNET && envNetwork === NEAR_TESTNET) {
    logger.warn(
      "[nearConfig] Network forced to mainnet due to env mismatch fallback."
    );
  }
}

export const nearConfig = {
  networkId: runtimeNetworkId,
  socialContract: contractPerNetwork[runtimeNetworkId],
  evmWalletChain: evmWalletChains[runtimeNetworkId],
  rpcUrl: networkSettings[runtimeNetworkId].rpcUrl,
};

export const SocialContract = nearConfig.socialContract;
export const EVMWalletChain = nearConfig.evmWalletChain;
