"use client";

type PatchedIframeExecutorInstance = {
  readyPromise?: Promise<void>;
  __nearGovIframeReady?: boolean;
  __nearGovIframeReadyListening?: boolean;
};

type PatchedIframeExecutorPrototype = {
  __nearGovIframePatched?: boolean;
};

let patchPromise: Promise<void> | null = null;

export function ensureHotLabsWalletIframeReady(): Promise<void> {
  if (patchPromise) {
    return patchPromise;
  }

  if (typeof window === "undefined") {
    patchPromise = Promise.resolve();
    return patchPromise;
  }

  patchPromise = (async () => {
    try {
      const module = await import(
        "@hot-labs/near-connect/build/SandboxedWallet/iframe"
      );

      const IframeExecutor = module?.default;
      if (!IframeExecutor) {
        return;
      }

      const proto = IframeExecutor.prototype as PatchedIframeExecutorPrototype & {
        postMessage: (data: unknown) => void;
      };

      if (proto.__nearGovIframePatched) {
        return;
      }

      const originalPostMessage = proto.postMessage;

      proto.postMessage = function (
        this: PatchedIframeExecutorInstance,
        data: unknown
      ) {
        const send = () => {
          try {
            originalPostMessage.call(this, data);
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === "Iframe not loaded" &&
              this.readyPromise
            ) {
              void this.readyPromise.then(send);
              return;
            }
            throw error;
          }
        };

        if (!this.__nearGovIframeReadyListening) {
          this.__nearGovIframeReadyListening = true;
          this.readyPromise?.then(() => {
            this.__nearGovIframeReady = true;
          });
        }

        if (this.__nearGovIframeReady) {
          send();
          return;
        }

        if (this.readyPromise) {
          void this.readyPromise.then(send);
          return;
        }

        send();
      };

      proto.__nearGovIframePatched = true;
    } catch (error) {
      console.error(
        "[near-connect] failed to patch iframe postMessage readiness",
        error
      );
    }
  })();

  return patchPromise;
}
