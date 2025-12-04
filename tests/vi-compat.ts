import { JSDOM } from "jsdom";
import { vi } from "vitest";

const anyVi = vi as any;
const ensureDom = () => {
  const hasDom = typeof document !== "undefined" && (globalThis as any).document;
  const dom =
    hasDom && (globalThis as any).window
      ? undefined
      : new JSDOM("<!doctype html><html><body></body></html>", {
          url: "https://localhost",
        });

  const domWindow = (globalThis as any).window ?? dom?.window ?? (globalThis as any).document?.defaultView;
  const domNavigator = domWindow?.navigator;

  if (!hasDom && domWindow) {
    (globalThis as any).window = domWindow;
    (globalThis as any).document = domWindow.document;
    (globalThis as any).navigator = domNavigator;
  }

  if (domWindow) {
    (globalThis as any).HTMLElement ??= domWindow.HTMLElement;
    (globalThis as any).HTMLInputElement ??= domWindow.HTMLInputElement;
    (globalThis as any).HTMLButtonElement ??= domWindow.HTMLButtonElement;
    (globalThis as any).Event ??= domWindow.Event;
    (globalThis as any).CustomEvent ??= domWindow.CustomEvent;
    (globalThis as any).MouseEvent ??= domWindow.MouseEvent;
    (globalThis as any).NodeFilter ??= domWindow.NodeFilter;
    (globalThis as any).Node ??= domWindow.Node;
    (globalThis as any).Text ??= domWindow.Text;
    (globalThis as any).Blob ??= domWindow.Blob;
    (globalThis as any).File ??= domWindow.File;
    (globalThis as any).URL ??= domWindow.URL;
    if (!(globalThis as any).getComputedStyle && domWindow.getComputedStyle) {
      (globalThis as any).getComputedStyle = domWindow.getComputedStyle.bind(domWindow);
    }
    if (!("hardwareConcurrency" in (globalThis as any).navigator) && domNavigator) {
      Object.defineProperty(domNavigator, "hardwareConcurrency", {
        value: 4,
        writable: false,
      });
    }
    if (!(globalThis as any).MutationObserver) {
      (globalThis as any).MutationObserver =
        domWindow.MutationObserver ||
        (class MockMutationObserver {
          constructor(private readonly _cb: any) {}
          observe() {}
          disconnect() {}
          takeRecords() {
            return [] as any[];
          }
        } as any);
    }
  }
};
ensureDom();

const stubbedGlobals: Array<{
  stub: { restore?: () => void } | undefined;
  name: string;
  previous: unknown;
  fallbackRestore: () => void;
}> = [];

const stubbedEnvs: Array<{ key: string; previous: string | undefined }> = [];

// Ensure stubGlobal records restorers so we can clean up in tests.
const realStubGlobal = anyVi.stubGlobal?.bind(vi);
const realUnstubAllGlobals = anyVi.unstubAllGlobals?.bind(vi);
const realResetModules = anyVi.resetModules?.bind(vi);
anyVi.stubGlobal = (...args: [string, unknown]) => {
  const [name, value] = args;
  const previous = (globalThis as any)[name];

  const stub =
    realStubGlobal?.(...args) ||
    (() => {
      (globalThis as any)[name] = value;
      return {
        restore: () => {
          if (previous === undefined) {
            delete (globalThis as any)[name];
          } else {
            (globalThis as any)[name] = previous;
          }
        },
      };
    })();

  const fallbackRestore = () => {
    if (previous === undefined) {
      delete (globalThis as any)[name];
    } else {
      (globalThis as any)[name] = previous;
    }
  };

  stubbedGlobals.push({ stub, name, previous, fallbackRestore });

  return stub;
};

anyVi.unstubAllGlobals = () => {
  realUnstubAllGlobals?.();
  while (stubbedGlobals.length) {
    const stub = stubbedGlobals.pop();
    try {
      const restoreFn = stub?.stub?.restore ?? stub?.fallbackRestore;
      restoreFn?.();
    } catch (error) {
      // Ignore individual restore errors to avoid masking test failures.
      console.error("[vi-compat] Failed to restore global stub:", error);
      stub?.fallbackRestore();
    }
  }
};

anyVi.resetModules = () => {
  realResetModules?.();
  vi.resetAllMocks();
  vi.clearAllMocks();
};

// Polyfill env helpers for runners that don't provide them.
const realStubEnv = (anyVi as any).stubEnv?.bind(vi);
const realUnstubAllEnvs = (anyVi as any).unstubAllEnvs?.bind(vi);

anyVi.stubEnv = (key: string, value: string) => {
  const previous = process.env[key];
  realStubEnv?.(key, value);
  process.env[key] = value;
  stubbedEnvs.push({ key, previous });
};

anyVi.unstubAllEnvs = () => {
  realUnstubAllEnvs?.();
  while (stubbedEnvs.length) {
    const { key, previous } = stubbedEnvs.pop()!;
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
};

// Basic global stubs so tests can rely on fetch and object URLs even if the
// runner doesn't provide them.
if (!(globalThis as any).fetch) {
  (globalThis as any).fetch = vi.fn();
}
if (!(globalThis as any).URL?.createObjectURL) {
  (globalThis as any).URL = (globalThis as any).URL || ({}) as any;
  (globalThis as any).URL.createObjectURL = vi.fn(() => "blob://mock");
}
if (!(globalThis as any).URL?.revokeObjectURL) {
  (globalThis as any).URL = (globalThis as any).URL || ({}) as any;
  (globalThis as any).URL.revokeObjectURL = vi.fn();
}

export {};
