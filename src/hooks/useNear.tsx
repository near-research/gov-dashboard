"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ensureInitialized,
  getSharedNearState,
  sharedCallFunction,
  sharedSignIn,
  sharedSignOut,
  sharedViewFunction,
  subscribeToNearState,
  type CallFunctionParams,
  type NearState,
  type ViewFunctionParams,
} from "@/lib/near/connector-service";

export function useNear() {
  const [state, setState] = useState<NearState>(getSharedNearState());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const unsubscribe = subscribeToNearState((nextState) => {
      setState(nextState);
    });
    ensureInitialized();

    return () => {
      unsubscribe();
    };
  }, []);

  const signIn = useCallback(async () => {
    await sharedSignIn();
  }, []);

  const signOut = useCallback(async () => {
    await sharedSignOut();
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await sharedSignOut();
    } catch (error) {
      console.error("Disconnect error:", error);
    }
  }, []);

  const viewFunction = useCallback(
    async (params: ViewFunctionParams) => sharedViewFunction(params),
    []
  );

  const callFunction = useCallback(
    async (params: CallFunctionParams) => sharedCallFunction(params),
    []
  );

  return {
    signedAccountId: state.signedAccountId,
    wallet: state.wallet,
    signIn,
    signOut,
    loading: state.loading,
    viewFunction,
    callFunction,
    provider: state.provider,
    connector: state.connector,
  };
}
