declare global {
  interface Window {
    plausible?: (
      event: string,
      options?: { props: Record<string, string | number | boolean | null> }
    ) => void;
  }
}

export {};
