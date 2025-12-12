declare global {
  interface Window {
    plausible?: (
      event: string,
      options?: { props: Record<string, string | number | boolean | null> }
    ) => void;
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
  }
}

export {};
