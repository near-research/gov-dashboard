"use client";

import type {
  HarnessTestResult,
  WalletTestHarness,
} from "@/types/walletHarness";
import { isHarnessRuntimeEnabled } from "@/utils/harnessMode";

const waitForHarness = (timeout = 3000): Promise<WalletTestHarness> => {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (window.__NEAR_TEST_HARNESS__) {
        resolve(window.__NEAR_TEST_HARNESS__!);
        return;
      }
      if (Date.now() - start > timeout) {
        reject(new Error("NEAR wallet test harness not available"));
        return;
      }
      requestAnimationFrame(poll);
    };
    poll();
  });
};

async function runWalletHarnessSuite(): Promise<HarnessTestResult[]> {
  const harness = await waitForHarness();
  const results: HarnessTestResult[] = [];

  const run = async (name: string, action: () => Promise<void> | void) => {
    try {
      await action();
      results.push({ test: name, status: "PASS" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      results.push({ test: name, status: "FAIL", error: message });
    }
  };

  await run("Fallback sign-in updates state", async () => {
    harness.reset();
    harness.forceSignIn("tester.testnet");
    const state = harness.getState();
    if (state.signedAccountId !== "tester.testnet") {
      throw new Error("signedAccountId did not update via fallback");
    }
  });

  await run("Event without accounts uses wallet.getAccounts()", async () => {
    harness.reset();
    await harness.emitSignIn({
      useUndefinedAccounts: true,
      accountId: "eventless.testnet",
    });
    if (harness.getState().signedAccountId !== "eventless.testnet") {
      throw new Error("signIn handler failed to fetch accounts");
    }
  });

  await run("getAccounts failure clears account", async () => {
    harness.reset();
    await harness.emitSignIn({
      accountId: "broken.testnet",
      useUndefinedAccounts: true,
      throwOnGetAccounts: true,
    });
    if (harness.getState().signedAccountId !== "") {
      throw new Error("state not cleared after getAccounts failure");
    }
  });

  await run("Sign-out clears wallet state", async () => {
    harness.reset();
    harness.forceSignIn("signout.testnet");
    harness.emitSignOut();
    if (harness.getState().signedAccountId !== "") {
      throw new Error("signedAccountId remained after sign-out");
    }
  });

  await run("Harness reset clears connector", async () => {
    harness.reset();
    if (harness.getState().connector !== null) {
      throw new Error("connector not cleared after reset");
    }
  });

  await run("Single connector for multiple hooks", async () => {
    harness.reset();
    await Promise.all([
      harness.initialize(),
      harness.initialize(),
      harness.initialize(),
    ]);
    if (harness.getInitializationCount() !== 1) {
      throw new Error(
        `Expected 1 connector, got ${harness.getInitializationCount()}`
      );
    }
  });

  await run("Rapid sign-in clicks don't race", async () => {
    harness.reset();
    await Promise.all([
      harness.emitSignIn({ accountId: "user1.testnet" }),
      harness.emitSignIn({ accountId: "user2.testnet" }),
      harness.emitSignIn({ accountId: "user3.testnet" }),
    ]);
    if (!harness.getState().signedAccountId) {
      throw new Error("No account connected after concurrent sign-ins");
    }
  });

  await run("Equality guard prevents duplicate renders", async () => {
    harness.reset();
    const initial = harness.getRenderCount();
    harness.forceSignIn("same.testnet");
    const afterFirst = harness.getRenderCount();
    harness.forceSignIn("same.testnet");
    const afterSecond = harness.getRenderCount();
    if (afterSecond !== afterFirst) {
      throw new Error("Render triggered despite identical state");
    }
    if (afterFirst < initial) {
      throw new Error("Render count regressed unexpectedly");
    }
  });

  await run("Sign-out cleanup even on disconnect error", async () => {
    harness.reset();
    harness.forceSignIn("error.testnet");
    let threw = false;
    try {
      await harness.simulateSharedSignOut({ throwError: true });
    } catch {
      threw = true;
    }
    if (!threw) {
      throw new Error("Expected disconnect error was not thrown");
    }
    if (harness.getState().signedAccountId !== "") {
      throw new Error("State not cleaned up after disconnect error");
    }
  });

  await run("Defensive sync updates state without event", async () => {
    harness.reset();
    await harness.connectWithoutEvent({
      accountId: "defensive.testnet",
    });
    if (harness.getState().signedAccountId !== "defensive.testnet") {
      throw new Error("Defensive sync failed to update state");
    }
  });

  await run("All hook instances share same state", async () => {
    harness.reset();
    const ref1 = harness.getState();
    const ref2 = harness.getState();
    if (ref1 !== ref2) {
      throw new Error("Hook instances have different state references");
    }
    harness.forceSignIn("shared.testnet");
    if (ref1.signedAccountId !== "shared.testnet") {
      throw new Error("State not shared across instances");
    }
  });

  await run("Init promise reused after success", async () => {
    harness.reset();
    await harness.initialize();
    const first = harness.getInitPromiseCreationCount();
    await harness.initialize();
    const second = harness.getInitPromiseCreationCount();
    if (first !== second) {
      throw new Error("New init promise created instead of reusing existing");
    }
  });

  await run("Init promise reset after failure", async () => {
    harness.reset();
    let failed = false;
    try {
      await harness.initialize({ throwError: true });
    } catch {
      failed = true;
    }
    if (!failed) {
      throw new Error("Initialization did not fail as expected");
    }
    await harness.initialize();
    if (!harness.getState().connector) {
      throw new Error("Retry initialization failed");
    }
  });

  await run("Listeners cleaned up on unmount", async () => {
    harness.reset();
    const before = harness.getListenerCount();
    harness.simulateMount();
    const afterMount = harness.getListenerCount();
    if (afterMount !== before + 1) {
      throw new Error("Listener not added on mount");
    }
    harness.simulateUnmount();
    const afterUnmount = harness.getListenerCount();
    if (afterUnmount !== before) {
      throw new Error("Listener not removed on unmount");
    }
  });

  await run("Event handler prefers payload.accounts", async () => {
    harness.reset();
    const before = harness.getRpcCallCount();
    await harness.emitSignIn({
      accountsPayload: [{ accountId: "optimized.testnet" }],
    });
    const after = harness.getRpcCallCount();
    if (after !== before) {
      throw new Error("Made RPC call despite payload.accounts available");
    }
    if (harness.getState().signedAccountId !== "optimized.testnet") {
      throw new Error("Failed to use payload.accounts");
    }
  });

  window.__NEAR_WALLET_TEST_RESULTS__ = results;
  console.table(results);
  return results;
}

export function attachWalletTestRunner() {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    !isHarnessRuntimeEnabled()
  ) {
    return;
  }

  window.__runNearWalletTests__ = () => runWalletHarnessSuite();
}
