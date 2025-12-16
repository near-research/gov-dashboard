declare module "better-near-auth" {
  import type { BetterAuthPlugin } from "better-auth";
  import type { Near } from "near-kit";

  export type NEARNetwork = "mainnet" | "testnet";

  export interface AuthCallbacks {
    onSuccess?: () => void;
    onError?: (error: Error & { status?: number; code?: string }) => void;
  }

  export interface SiwnNonceResponse {
    nonce: string;
  }

  export interface SiwnVerifyResponse {
    token: string;
    success: true;
    user: {
      id: string;
      accountId: string;
      network: NEARNetwork;
    };
  }

  export interface LinkedAccount {
    id: string;
    userId: string;
    accountId: string;
    network: NEARNetwork;
    publicKey: string;
    isPrimary: boolean;
    createdAt: string;
  }

  export interface NearProfileImage {
    url?: string;
    ipfs_cid?: string;
  }

  export interface NearProfile {
    name?: string;
    description?: string;
    image?: NearProfileImage;
    backgroundImage?: NearProfileImage;
    linktree?: Record<string, string>;
  }

  export interface SiwnOptions {
    recipient?: string;
    anonymous?: boolean;
    requireFullAccessKey?: boolean;
  }

  export interface NearAuthClientState {
    accountId: string | null;
    publicKey: string | null;
    networkId: NEARNetwork;
  }

  export interface NearAuthClient {
    nonce: (params: {
      accountId: string;
      publicKey: string;
      networkId: NEARNetwork;
    }) => Promise<SiwnNonceResponse>;
    verify: (params: {
      accountId: string;
      publicKey: string;
      signature: string;
      message: string;
      recipient: string;
    }) => Promise<SiwnVerifyResponse>;
    getProfile: (accountId?: string) => Promise<NearProfile | null>;
    getNearClient: () => Near;
    getAccountId: () => string | null;
    getState: () => NearAuthClientState | null;
    disconnect: () => Promise<void>;
    link: (
      params: { recipient: string },
      callbacks?: AuthCallbacks
    ) => Promise<void>;
    unlink: (params: {
      accountId: string;
      network?: NEARNetwork;
    }) => Promise<{
      success: true;
      accountId: string;
      network: NEARNetwork;
      message: string;
    }>;
    listAccounts: () => Promise<{ accounts: LinkedAccount[] }>;
  }

  export function siwn(options?: SiwnOptions): BetterAuthPlugin;
}

declare module "better-near-auth/client" {
  import type { BetterAuthClientPlugin } from "better-auth/react";
  import type { AuthCallbacks } from "better-near-auth";

  export interface SiwnClientOptions {
    domain?: string;
    networkId?: "mainnet" | "testnet" | string;
  }

  export interface SIWNClientActions {
    near: import("better-near-auth").NearAuthClient;
    requestSignIn: {
      near: (params: { recipient: string }, callbacks?: AuthCallbacks) => Promise<void>;
    };
    signIn: {
      near: (params: { recipient: string }, callbacks?: AuthCallbacks) => Promise<void>;
    };
  }

  export interface SIWNClientPlugin extends BetterAuthClientPlugin {
    id: "siwn";
    getActions: () => SIWNClientActions;
  }

  export function siwnClient(options?: SiwnClientOptions): SIWNClientPlugin;
}
