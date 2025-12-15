import type { WalletInterface } from "near-sign-verify";

/**
 * Asserts that a wallet signer exists so downstream code can sign safely.
 */
export function assertWalletSigner(
  signer: WalletInterface | null
): asserts signer is WalletInterface {
  if (!signer) {
    throw new Error("Wallet not connected. Please connect your NEAR wallet.");
  }
}

/**
 * Asserts that signing conditions are met (signer + account) before producing tokens.
 */
export function assertSigningReady(
  signer: WalletInterface | null,
  accountId: string | null | undefined
): asserts signer is WalletInterface {
  assertWalletSigner(signer);
  if (!accountId) {
    throw new Error("NEAR account not found. Please connect your wallet.");
  }
}
