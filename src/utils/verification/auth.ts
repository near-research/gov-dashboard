import type { WalletInterface } from "near-sign-verify";
import { sign } from "near-sign-verify";
import { siwnRecipient } from "@/config/siwn";

export interface VerificationAuthTokenParams {
  walletSigner: WalletInterface;
  verificationId?: string;
  recipient?: string;
}

export async function createVerificationAuthToken({
  walletSigner,
  verificationId,
  recipient,
}: VerificationAuthTokenParams): Promise<string> {
  const message = verificationId
    ? `Fetch verification proof ${verificationId}`
    : "Fetch verification proof";
  return sign(message, {
    signer: walletSigner,
    recipient: recipient ?? siwnRecipient,
  });
}
