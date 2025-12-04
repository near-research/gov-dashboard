import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as connector from "@/lib/near/connector-service";

describe("sharedSignOut", () => {
  const resetState = () => {
    const state = connector.getSharedNearState() as any;
    state.wallet = undefined;
    state.connector = null;
    state.signedAccountId = "";
    state.provider = null;
    state.loading = false;
  };

  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetState();
  });

  it("is idempotent when no wallet is connected", async () => {
    vi.spyOn(connector, "ensureInitialized").mockResolvedValue();
    const state = connector.getSharedNearState();

    await expect(connector.sharedSignOut()).resolves.toBeUndefined();
    expect(state.wallet).toBeUndefined();
    expect(state.signedAccountId).toBe("");
  });

  it("disconnects when a wallet is connected", async () => {
    vi.spyOn(connector, "ensureInitialized").mockResolvedValue();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const wallet = { id: "wallet-1" } as any;
    const state = connector.getSharedNearState() as any;
    state.wallet = wallet;
    state.connector = { disconnect } as any;

    await connector.sharedSignOut();

    expect(disconnect).toHaveBeenCalledWith(wallet);
    expect(state.wallet).toBeUndefined();
    expect(state.signedAccountId).toBe("");
  });
});
