"use client";

import type {
  NearConnector as NearConnectorClass,
  NearWalletBase,
} from "@hot-labs/near-connect";
import type { JsonRpcProvider } from "@near-js/providers";

export type HarnessSignInOptions = {
  accountId?: string;
  accountsPayload?: Array<{ accountId: string; publicKey?: string }>;
  useUndefinedAccounts?: boolean;
  throwOnGetAccounts?: boolean;
};

export type HarnessWallet = NearWalletBase;
export type HarnessConnector = NearConnectorClass;
export type HarnessProvider = JsonRpcProvider;

export interface HarnessState {
  wallet: HarnessWallet | undefined;
  signedAccountId: string;
  loading: boolean;
  connector: HarnessConnector | null;
  provider: HarnessProvider | null;
}

export type HarnessTestResult = {
  test: string;
  status: "PASS" | "FAIL";
  error?: string;
};

export interface WalletTestHarness {
  getState: () => HarnessState;
  forceSignIn: (accountId?: string) => void;
  emitSignIn: (options?: HarnessSignInOptions) => Promise<void>;
  emitSignOut: () => void;
  reset: () => void;
  getInitializationCount: () => number;
  getInitPromiseCreationCount: () => number;
  getRenderCount: () => number;
  getRpcCallCount: () => number;
  getListenerCount: () => number;
  initialize: (options?: { throwError?: boolean }) => Promise<void>;
  connectWithoutEvent: (options: { accountId: string }) => Promise<void>;
  simulateMount: () => void;
  simulateUnmount: () => void;
  simulateSharedSignOut: (options?: {
    throwError?: boolean;
    accountId?: string;
  }) => Promise<void>;
}

declare global {
  interface Window {
    __NEAR_TEST_HARNESS__?: WalletTestHarness;
    __NEAR_WALLET_TEST_RESULTS__?: HarnessTestResult[];
    __runNearWalletTests__?: () => Promise<HarnessTestResult[]>;
    enableNearHarness?: () => void;
    disableNearHarness?: () => void;
    resetNearHarnessMode?: () => void;
  }
}

export {};
