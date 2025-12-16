import type { WalletInterface } from "near-sign-verify";
import { siwnRecipient } from "@/config/siwn";
import { SIGNING_MESSAGES } from "@/constants/signing-messages";
import { assertSigningReady } from "@/utils/wallet/guards";
import { readJsonSafe } from "@/utils/json";

interface ScreenProposalParams {
  proposalId: string;
  title: string;
  content: string;
  revisionNumber: number;
  walletSigner: WalletInterface | null;
  signedAccountId: string | null;
}

interface ScreenProposalResult {
  response: Response;
  payload: Record<string, unknown> | null;
}

export async function screenProposalRevision({
  proposalId,
  title,
  content,
  revisionNumber,
  walletSigner,
  signedAccountId,
}: ScreenProposalParams): Promise<ScreenProposalResult> {
  assertSigningReady(walletSigner, signedAccountId);

  const { sign } = await import("near-sign-verify");

  const authToken = await sign(SIGNING_MESSAGES.screenProposal(proposalId), {
    signer: walletSigner,
    recipient: siwnRecipient,
  });

  const response = await fetch(`/api/saveAnalysis/${proposalId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      title,
      content,
      revisionNumber,
    }),
  });

  const payload = await readJsonSafe(response);

  return { response, payload };
}
