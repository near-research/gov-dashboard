"use client";

import type {
  NearConnector as NearConnectorClass,
  NearWalletBase,
  WalletManifest,
} from "@hot-labs/near-connect";
import type { JsonRpcProvider } from "@near-js/providers";
import type { FinalExecutionOutcome } from "@near-js/types";
import type {
  HarnessSignInOptions,
  WalletTestHarness,
} from "@/types/walletHarness";
import {
  isHarnessRuntimeEnabled,
  registerHarnessToggleShortcuts,
} from "@/utils/harnessMode";
import { nearConfig } from "@/config/near";

type NearWallet = NearWalletBase;
type NearConnector = NearConnectorClass;
type HarnessAccountsPayload = NonNullable<
  HarnessSignInOptions["accountsPayload"]
>;

interface ConnectorSignInPayload {
  wallet: NearWallet;
  accounts?: HarnessAccountsPayload;
}

export interface ViewFunctionParams {
  contractId: string;
  method: string;
  args?: Record<string, any>;
}

export interface CallFunctionParams {
  contractId: string;
  method: string;
  args?: Record<string, any>;
  gas?: string;
  deposit?: string;
}

export interface NearState {
  wallet: NearWallet | undefined;
  signedAccountId: string;
  loading: boolean;
  connector: NearConnector | null;
  provider: JsonRpcProvider | null;
}

let sharedState: NearState = {
  wallet: undefined,
  signedAccountId: "",
  loading: true,
  connector: null,
  provider: null,
};

type StateListener = (state: NearState) => void;
const listeners = new Set<StateListener>();

let initPromise: Promise<void> | null = null;
let connectorInstance: NearConnector | null = null;
let connectorListenersAttached = false;
const isDevEnv = process.env.NODE_ENV !== "production";

const shouldSimulateHarnessRejection = () => {
  if (typeof window === "undefined") {
    return false;
  }
  const harness = (window as any).__NEAR_TEST_HARNESS__;
  if (!harness?.rejectConnection) {
    return false;
  }
  harness.rejectConnection = false;
  return true;
};

type DevInstrumentation = {
  connectorInitCount: number;
  initPromiseCreations: number;
  renderCount: number;
  rpcCallCount: number;
  forceInitFailure: boolean;
};

const devInstrumentation: DevInstrumentation | null = isDevEnv
  ? {
      connectorInitCount: 0,
      initPromiseCreations: 0,
      renderCount: 0,
      rpcCallCount: 0,
      forceInitFailure: false,
    }
  : null;
let harnessRuntimeInitialized = false;

const notifyListeners = (snapshot: NearState) => {
  listeners.forEach((listener) => listener(snapshot));
};

const updateState = (updates: Partial<NearState>) => {
  Object.assign(sharedState, updates);
  if (devInstrumentation) {
    devInstrumentation.renderCount += 1;
  }
  notifyListeners({ ...sharedState });
};

const syncWalletState = (
  wallet: NearWallet | undefined,
  signedAccountId: string
) => {
  if (
    sharedState.wallet === wallet &&
    sharedState.signedAccountId === signedAccountId
  ) {
    return;
  }

  updateState({
    wallet,
    signedAccountId,
  });
};

const trackWalletConnectSuccess = (accountId: string) => {
  if (typeof window !== "undefined" && window.plausible) {
    window.plausible("wallet_connect_succeeded", {
      props: { account_id: accountId },
    });
  }
};

const handleConnectorSignOut = () => {
  syncWalletState(undefined, "");
};

const handleConnectorSignIn = async (payload: ConnectorSignInPayload) => {
  try {
    let accounts = payload.accounts;
    if (!accounts) {
      devInstrumentation && (devInstrumentation.rpcCallCount += 1);
      accounts = await payload.wallet.getAccounts();
    }
    const accountId = accounts?.[0]?.accountId ?? "";
    syncWalletState(payload.wallet, accountId);

    if (accountId) {
      trackWalletConnectSuccess(accountId);
    }
  } catch (err) {
    console.error("Failed to fetch wallet accounts:", err);
    syncWalletState(payload.wallet, "");
  }
};

const detachConnectorListeners = () => {
  if (!connectorInstance || !connectorListenersAttached) return;
  connectorInstance.off("wallet:signOut", handleConnectorSignOut);
  connectorInstance.off("wallet:signIn", handleConnectorSignIn);
  connectorListenersAttached = false;
};

const attachConnectorListeners = (conn: NearConnector) => {
  if (connectorListenersAttached) return;
  conn.on("wallet:signOut", handleConnectorSignOut);
  conn.on("wallet:signIn", handleConnectorSignIn);
  connectorListenersAttached = true;
};

export async function ensureInitialized() {
  if (typeof window === "undefined") {
    return;
  }

  if (connectorInstance && !connectorListenersAttached) {
    attachConnectorListeners(connectorInstance);
  }

  if (initPromise) {
    return initPromise;
  }

  if (!initPromise) {
    devInstrumentation && (devInstrumentation.initPromiseCreations += 1);
    let success = false;

    const init = (async () => {
      try {
        const [{ NearConnector }, { JsonRpcProvider }] = await Promise.all([
          import("@hot-labs/near-connect"),
          import("@near-js/providers"),
        ]);

        const nearConnector = new NearConnector({
          network: nearConfig.networkId,
          walletConnect: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
            ? {
                projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
                metadata: {
                  name: "NEAR Governance Dashboard",
                  description:
                    "AI-powered governance dashboard for NEAR community",
                  url:
                    typeof window !== "undefined"
                      ? window.location.origin
                      : "https://gov.near.org",
                  icons:
                    typeof window !== "undefined"
                      ? [`${window.location.origin}/near-logo.svg`]
                      : [],
                },
              }
            : undefined,
        });
        const rpcProvider = new JsonRpcProvider({
          url: nearConfig.rpcUrl,
        });

        if (devInstrumentation?.forceInitFailure) {
          throw new Error("Simulated init failure");
        }

        detachConnectorListeners();
        connectorInstance = nearConnector;
        attachConnectorListeners(nearConnector);
        devInstrumentation && (devInstrumentation.connectorInitCount += 1);

        updateState({
          connector: nearConnector,
          provider: rpcProvider,
        });

        try {
          const { wallet, accounts } = await nearConnector.getConnectedWallet();
          if (wallet && accounts?.length) {
            syncWalletState(wallet, accounts[0].accountId);
          }
        } catch (error) {
          if (process.env.NODE_ENV !== "production") {
            console.debug("NEAR wallet rehydrate skipped:", error);
          }
        }

        success = true;
      } catch (error) {
        console.error("Failed to initialize NEAR:", error);
        detachConnectorListeners();
        connectorInstance = null;
        updateState({
          connector: null,
          provider: null,
          wallet: undefined,
          signedAccountId: "",
        });
        throw error;
      } finally {
        updateState({ loading: false });

        if (!success) {
          initPromise = null;
        }
      }
    })();

    initPromise = init;
  }

  return initPromise;
}

export async function sharedSignIn() {
  await ensureInitialized();
  const connector = sharedState.connector;
  if (!connector) {
    throw new Error("Connector not initialized (not in browser)");
  }

  if (shouldSimulateHarnessRejection()) {
    const rejectionError = new Error("User rejected the wallet connection");
    rejectionError.name = "NearUserRejected";
    throw rejectionError;
  }

  try {
    await connector.connect();

    try {
      const { wallet, accounts } = await connector.getConnectedWallet();
      if (wallet && accounts?.length > 0) {
        syncWalletState(wallet, accounts[0].accountId);
      }
    } catch (syncError: unknown) {
      const message =
        syncError instanceof Error ? syncError.message : String(syncError);
      if (message.includes("No wallet selected")) return;
      console.error("Failed to sync wallet state:", syncError);
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    if (message.toLowerCase().includes("user rejected")) {
      console.info("Wallet connection cancelled by user.");
      return;
    }
    console.error("Sign in error:", error);
    throw error instanceof Error ? error : new Error(message);
  }
}

export async function sharedSignOut() {
  await ensureInitialized();
  const connector = sharedState.connector;
  const wallet = sharedState.wallet;
  if (!connector || !wallet) {
    syncWalletState(undefined, "");
    return;
  }

  try {
    await connector.disconnect(wallet);
  } catch (error) {
    console.error("Sign out error:", error);
    throw error;
  } finally {
    syncWalletState(undefined, "");
  }
}

export async function sharedViewFunction({
  contractId,
  method,
  args = {},
}: ViewFunctionParams) {
  await ensureInitialized();
  const provider = sharedState.provider;
  if (!provider) {
    throw new Error("Provider not initialized");
  }

  return provider.callFunction(contractId, method, args);
}

export async function sharedCallFunction({
  contractId,
  method,
  args = {},
  gas = "30000000000000",
  deposit = "0",
}: CallFunctionParams) {
  await ensureInitialized();
  const wallet = sharedState.wallet;
  if (!wallet) {
    throw new Error("Wallet not connected");
  }

  return wallet.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      {
        type: "FunctionCall",
        params: {
          methodName: method,
          args,
          gas,
          deposit,
        },
      },
    ],
  });
}

export const registerTestHarness = () => {
  if (typeof window === "undefined" || !isHarnessRuntimeEnabled()) {
    return;
  }

  const testMountListeners = new Set<StateListener>();
  const stubWalletCache = new Map<string, NearWallet>();

  const getStubWallet = (accountId: string = "tester.testnet"): NearWallet => {
    if (!stubWalletCache.has(accountId)) {
      const account = { accountId, publicKey: "test-public-key" };
      const manifest: WalletManifest = {
        id: "dev-wallet",
        platform: ["web"],
        name: "Development Wallet",
        icon: "",
        description: "Local testing wallet",
        website: "http://localhost",
        version: "1.0.0",
        executor: "browser",
        type: "sandbox",
        permissions: {},
        features: {
          signMessage: true,
          signTransaction: true,
          signAndSendTransaction: true,
          signAndSendTransactions: true,
          signInWithoutAddKey: true,
          mainnet: true,
          testnet: true,
        },
      };

      const zeroOutcome = {} as FinalExecutionOutcome;

      const wallet: NearWallet = {
        manifest,
        async signIn() {
          return [account];
        },
        async signOut() {
          syncWalletState(undefined, "");
        },
        async getAccounts() {
          return [account];
        },
        async signAndSendTransaction() {
          return zeroOutcome;
        },
        async signAndSendTransactions() {
          return [zeroOutcome];
        },
        async signMessage() {
          return {
            accountId,
            publicKey: account.publicKey,
            signature: "dev",
          };
        },
      };

      stubWalletCache.set(accountId, wallet);
    }
    return stubWalletCache.get(accountId)!;
  };

  const harness: WalletTestHarness = {
    getState: () => sharedState,
    forceSignIn(accountId = "tester.testnet") {
      const wallet = getStubWallet(accountId);
      syncWalletState(wallet, accountId);
    },
    async emitSignIn(options: HarnessSignInOptions = {}) {
      const accountId = options.accountId ?? "tester.testnet";
      const wallet = getStubWallet(accountId);

      if (options.throwOnGetAccounts) {
        wallet.getAccounts = async () => {
          throw new Error("Simulated getAccounts failure");
        };
      } else if (options.accountsPayload) {
        wallet.getAccounts = async () =>
          options.accountsPayload!.map((acc) => ({
            accountId: acc.accountId,
            publicKey: acc.publicKey ?? "test-public-key",
          }));
      }

      const accountsPayload =
        options.accountsPayload?.map((acc) => ({
          accountId: acc.accountId,
          publicKey: acc.publicKey ?? "test-public-key",
        })) ?? [{ accountId, publicKey: "test-public-key" }];

      await handleConnectorSignIn({
        wallet,
        accounts: options.useUndefinedAccounts ? undefined : accountsPayload,
      });
    },
    emitSignOut() {
      handleConnectorSignOut();
    },
    async initialize(options?: { throwError?: boolean }) {
      const shouldFail = !!options?.throwError && !!devInstrumentation;
      if (shouldFail && devInstrumentation) {
        devInstrumentation.forceInitFailure = true;
      }
      try {
        await ensureInitialized();
      } finally {
        if (shouldFail && devInstrumentation) {
          devInstrumentation.forceInitFailure = false;
        }
      }
    },
    async connectWithoutEvent({ accountId }: { accountId: string }) {
      const wallet = getStubWallet(accountId);
      syncWalletState(wallet, accountId);
    },
    simulateMount() {
      const listener: StateListener = () => {};
      listeners.add(listener);
      testMountListeners.add(listener);
    },
    simulateUnmount() {
      const iterator = testMountListeners.values().next();
      if (!iterator.done) {
        const listener = iterator.value;
        listeners.delete(listener);
        testMountListeners.delete(listener);
      }
    },
    async simulateSharedSignOut(options?: {
      throwError?: boolean;
      accountId?: string;
    }) {
      const wallet = getStubWallet(options?.accountId ?? "error.testnet");
      const connector = {
        async connect() {
          return wallet;
        },
        async disconnect() {
          if (options?.throwError) {
            throw new Error("Simulated disconnect error");
          }
        },
      } as NearConnector;
      sharedState.wallet = wallet;
      sharedState.connector = connector;
      initPromise = Promise.resolve();
      try {
        await sharedSignOut();
      } finally {
        sharedState.connector = null;
      }
    },
    getInitializationCount: () => devInstrumentation?.connectorInitCount ?? 0,
    getInitPromiseCreationCount: () =>
      devInstrumentation?.initPromiseCreations ?? 0,
    getRenderCount: () => devInstrumentation?.renderCount ?? 0,
    getRpcCallCount: () => devInstrumentation?.rpcCallCount ?? 0,
    getListenerCount: () => listeners.size,
    reset() {
      sharedState.wallet = undefined;
      sharedState.signedAccountId = "";
      sharedState.connector = null;
      sharedState.provider = null;
      sharedState.loading = false;
      detachConnectorListeners();
      connectorInstance = null;
      initPromise = null;
      if (devInstrumentation) {
        devInstrumentation.connectorInitCount = 0;
        devInstrumentation.initPromiseCreations = 0;
        devInstrumentation.renderCount = 0;
        devInstrumentation.rpcCallCount = 0;
        devInstrumentation.forceInitFailure = false;
      }
      stubWalletCache.clear();
      testMountListeners.forEach((listener) => listeners.delete(listener));
      testMountListeners.clear();
      notifyListeners({ ...sharedState });
    },
  };

  window.__NEAR_TEST_HARNESS__ = harness;
};

const initHarnessRuntime = () => {
  if (typeof window === "undefined" || harnessRuntimeInitialized) {
    return;
  }
  harnessRuntimeInitialized = true;

  registerHarnessToggleShortcuts();
  if (isHarnessRuntimeEnabled()) {
    registerTestHarness();
    import("@/devtools/walletHarness")
      .then(({ attachWalletTestRunner }) => {
        attachWalletTestRunner();
      })
      .catch((error) => {
        console.error("Failed to attach wallet harness:", error);
      });
  }
};

if (typeof window !== "undefined") {
  initHarnessRuntime();
}

export const subscribeToNearState = (listener: StateListener) => {
  listeners.add(listener);
  listener(sharedState);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detachConnectorListeners();
    }
  };
};

export const getSharedNearState = () => sharedState;
