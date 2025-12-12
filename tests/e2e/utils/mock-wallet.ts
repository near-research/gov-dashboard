import { Buffer } from "buffer";
import type { Page } from "@playwright/test";

const SIGNATURE_PAYLOAD = "mock-signature-for-testing";
const PUBLIC_KEY = "ed25519:MockPublicKeyForE2ETesting1234567890123456789012";

export async function injectMockWalletSigner(page: Page, accountId: string) {
  const signature = Buffer.from(SIGNATURE_PAYLOAD).toString("base64");
  await page.addInitScript(
    (args: string[]) => {
      const [id, encodedSignature] = args;
      (window as typeof window & {
        __PLAYWRIGHT_MOCK_WALLET__?: {
          accountId: string;
          signMessage: (params: {
            message: string;
            recipient: string;
            nonce?: Uint8Array | number[];
          }) => Promise<{
            signature: string;
            publicKey: string;
            accountId: string;
          }>;
        };
        __PLAYWRIGHT_WALLET_ACCOUNT__?: string;
      }).__PLAYWRIGHT_MOCK_WALLET__ = {
        accountId: id,
        signMessage: async () => ({
          signature: encodedSignature,
          publicKey: PUBLIC_KEY,
          accountId: id,
        }),
      };
      (window as typeof window & {
        __PLAYWRIGHT_WALLET_ACCOUNT__?: string;
      }).__PLAYWRIGHT_WALLET_ACCOUNT__ = id;
    },
    [accountId, signature]
  );
}
