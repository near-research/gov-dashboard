import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test-setup.ts"],
    include: [
      "tests/unit/**/*.{test,spec}.{ts,tsx}",
      "tests/verification/**/*.test.ts",
      "tests/services/**/*.test.ts",
      "src/lib/near-ai/verification/__tests__/**/*.test.ts",
    ],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/mocks/server-only.ts"),
    },
  },
});
