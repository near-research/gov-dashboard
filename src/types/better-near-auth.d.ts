declare module "better-near-auth" {
  import type { BetterAuthPlugin } from "better-auth";

  export interface SiwnOptions {
    recipient?: string;
    anonymous?: boolean;
    requireFullAccessKey?: boolean;
  }

  export function siwn(options?: SiwnOptions): BetterAuthPlugin;
}

declare module "better-near-auth/client" {
  import type { BetterAuthClientPlugin } from "better-auth/react";

  export interface AuthCallbacks {
    onSuccess?: () => void;
    onError?: (error: Error & { status?: number; code?: string }) => void;
  }

  export interface SiwnClientOptions {
    domain?: string;
    networkId?: "mainnet" | "testnet" | string;
  }

  export interface SIWNClientActions {
    near: {
      nonce: (params: { accountId: string; publicKey: string; networkId: string }) => Promise<any>;
      verify: (params: { accountId: string; publicKey: string; networkId: string; signature: string; message: string; recipient: string }) => Promise<any>;
      getProfile: (accountId?: string) => Promise<any>;
      getNearClient: () => any;
      getAccountId: () => string | null;
      getState: () => { accountId: string | null; publicKey: string | null; networkId: string } | null;
      disconnect: () => Promise<void>;
      link: (params: { recipient: string }, callbacks?: AuthCallbacks) => Promise<void>;
      unlink: (params: { accountId: string; network?: "mainnet" | "testnet" }) => Promise<any>;
      listAccounts: () => Promise<any>;
    };
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
