"use client";

import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import type { VerificationMetadata } from "@/lib/near-ai";

export type VerificationStatus =
  | "idle"
  | "pending"
  | "verifying"
  | "verified"
  | "failed"
  | "unknown";

export interface VerificationState {
  status: VerificationStatus;
  metadata: VerificationMetadata | null;
  error: string | null;
  lastUpdated: Date | null;
}

interface VerificationContextValue {
  state: VerificationState;
  updateVerification: (metadata: VerificationMetadata) => void;
  setStatus: (status: VerificationStatus, error?: string) => void;
  reset: () => void;
}

const initialState: VerificationState = {
  status: "idle",
  metadata: null,
  error: null,
  lastUpdated: null,
};

const STORAGE_KEY = "gov_verification_v1";

const normalizeVerificationStatus = (
  metadataStatus?: VerificationMetadata["status"]
): VerificationStatus => {
  if (metadataStatus === "verified") return "verified";
  if (metadataStatus === "failed") return "failed";
  if (metadataStatus === "pending") return "pending";
  if (metadataStatus === "unknown") return "unknown";
  return "verifying";
};

const VerificationContext = createContext<VerificationContextValue | null>(null);

export function VerificationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VerificationState>(() => {
    if (typeof window === "undefined") {
      return initialState;
    }

    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          ...initialState,
          ...parsed,
          lastUpdated: parsed.lastUpdated ? new Date(parsed.lastUpdated) : null,
        };
      }
    } catch {
      // ignore
    }

    return initialState;
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (state.status === "idle") {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }

    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...state,
          lastUpdated: state.lastUpdated?.toISOString() ?? null,
        })
      );
    } catch {
      // ignore
    }
  }, [state]);

  const updateVerification = useCallback((metadata: VerificationMetadata) => {
    setState((prev) => ({
      ...prev,
      status: normalizeVerificationStatus(metadata.status),
      metadata: { ...prev.metadata, ...metadata },
      error: null,
      lastUpdated: new Date(),
    }));
  }, []);

  const setStatus = useCallback((status: VerificationStatus, error?: string) => {
    setState((prev) => ({
      ...prev,
      status,
      error: error ?? null,
      lastUpdated: new Date(),
    }));
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const value = useMemo(
    () => ({
      state,
      updateVerification,
      setStatus,
      reset,
    }),
    [state, updateVerification, setStatus, reset]
  );

  return (
    <VerificationContext.Provider value={value}>
      {children}
    </VerificationContext.Provider>
  );
}

export function useVerification(): VerificationContextValue {
  const context = useContext(VerificationContext);
  if (!context) {
    throw new Error("useVerification must be used within VerificationProvider");
  }
  return context;
}

export function useVerificationSafe(): VerificationContextValue | null {
  return useContext(VerificationContext);
}
