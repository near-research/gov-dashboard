declare global {
  interface Window {
    plausible?: (
      event: string,
      options?: { props: Record<string, string | number | boolean | null> }
    ) => void;
    __NEAR_TEST_HARNESS__?: import("./walletHarness").WalletTestHarness;
  }
}

export {};
