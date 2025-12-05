import { vi } from "vitest";
import { JSDOM } from "jsdom";

if (!process.env.NODE_ENV) {
  (process.env as any).NODE_ENV = "test";
}

const ensureDom = () => {
  if (typeof document !== "undefined" && (globalThis as any).document) return;
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://localhost",
  });
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).navigator = dom.window.navigator;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).Event = dom.window.Event;
  (globalThis as any).CustomEvent = dom.window.CustomEvent;
  (globalThis as any).MouseEvent = dom.window.MouseEvent;
  (globalThis as any).NodeFilter = dom.window.NodeFilter;
  (globalThis as any).Node = dom.window.Node;
  (globalThis as any).Text = dom.window.Text;
  (globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
  (globalThis as any).HTMLButtonElement = dom.window.HTMLButtonElement;
  (globalThis as any).Blob = dom.window.Blob;
  (globalThis as any).File = dom.window.File;
  (globalThis as any).URL = dom.window.URL;
  if (!(globalThis as any).getComputedStyle && dom.window.getComputedStyle) {
    (globalThis as any).getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  }
  if (!(globalThis as any).requestAnimationFrame) {
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
      setTimeout(cb, 0);
  }
  if (!(globalThis as any).cancelAnimationFrame) {
    (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
  }

  const navigatorObj = (globalThis as any).navigator;
  if (navigatorObj) {
    const hardwareConcurrencyDescriptor = Object.getOwnPropertyDescriptor(
      navigatorObj,
      "hardwareConcurrency"
    );
    const needsOverride =
      !hardwareConcurrencyDescriptor ||
      typeof hardwareConcurrencyDescriptor.get === "function";

    if (needsOverride) {
      try {
        Object.defineProperty(navigatorObj, "hardwareConcurrency", {
          value: 4,
          writable: false,
          configurable: true,
        });
      } catch {
        // ignore if navigator cannot be reconfigured in this environment
      }
    }
  }
};

ensureDom();

await import("@testing-library/jest-dom/vitest");
const { cleanup } = await import("@testing-library/react");

const moduleMocks: Map<string, any> = ((globalThis as any).__moduleMocks ??= new Map());

// Keep moduleMocks cleared between tests so mock state doesn't leak.
const registerHooks = () => {
  const beforeEachFn = (vi as any).beforeEach ?? (globalThis as any).beforeEach;
  const afterEachFn = (vi as any).afterEach ?? (globalThis as any).afterEach;

  beforeEachFn?.(() => {
    ensureDom();
    moduleMocks.clear();
    if (typeof document !== "undefined" && document.body) {
      document.body.innerHTML = "";
    }
  });
  afterEachFn?.(() => {
    moduleMocks.clear();
    cleanup();
  });
};
registerHooks();

// Ensure vi.mock/doMock populate the shared __moduleMocks map used by runtime code.
const wrapViMock = () => {
  const anyVi = vi as any;
  if (anyVi.mock && !(anyVi.mock as any).__moduleMockWrapped) {
    const originalMock = anyVi.mock.bind(vi);
    const wrapped = (id: string, factory?: () => any) => {
      if (factory) {
        const moduleValue = factory();
        moduleMocks.set(id, moduleValue);
        return originalMock(id, () => moduleValue);
      }
      return originalMock(id);
    };
    (wrapped as any).__moduleMockWrapped = true;
    anyVi.mock = wrapped;
  }

  if (!anyVi.doMock) {
    anyVi.doMock = async (id: string, factory: () => any) => {
      const moduleValue = await factory();
      moduleMocks.set(id, moduleValue);
      return moduleValue;
    };
  }

  if (!anyVi.importActual) {
    anyVi.importActual = (id: string) => import(id);
  }
};
wrapViMock();

// Mock fetch globally for API-heavy tests.
if (!global.fetch) {
  global.fetch = vi.fn();
}

// Stub URL helpers used in download/export code.
if (!global.URL.createObjectURL) {
  global.URL.createObjectURL = vi.fn(() => "blob://mock");
}
if (!global.URL.revokeObjectURL) {
  global.URL.revokeObjectURL = vi.fn();
}

// Bun's vi doesn't always expose advanceTimers helpers; provide a fallback so
// timer-based tests can advance fake time consistently.
const anyVi = vi as any;

if (!anyVi.mocked) {
  anyVi.mocked = <T>(value: T) => value;
}
if (!anyVi.advanceTimersByTime && anyVi.setSystemTime) {
  anyVi.advanceTimersByTime = (ms: number) => {
    const now = Date.now();
    anyVi.setSystemTime(now + ms);
    anyVi.runOnlyPendingTimers?.();
  };
}

// Radix UI expects MutationObserver in the environment; jsdom on Bun may not
// provide it, so install a lightweight stub for tests.
if (!(global as any).MutationObserver) {
  class MockMutationObserver {
    constructor(private readonly _cb: any) {}
    observe() {}
    disconnect() {}
    takeRecords() {
      return [] as any[];
    }
  }
  (global as any).MutationObserver = MockMutationObserver as any;
}
