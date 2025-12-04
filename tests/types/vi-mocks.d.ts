import type { Vi } from "vitest";

declare module "vitest" {
  interface Vi {
    mocked<T>(value: T): T;
  }
}
