import eslintPlugin from "@typescript-eslint/eslint-plugin";
import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/**
 * Bridge the former `.eslintrc.json` (which extended `next/core-web-vitals`)
 * into ESLint 9's flat-config format using FlatCompat.
 */
const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const config = [
  {
    ignores: ["**/.next/**", "node_modules/**", "dist/**", "coverage/**"],
    plugins: {
      "@typescript-eslint": eslintPlugin,
    },
  },
  ...compat.extends("next/core-web-vitals"),
];

export default config;
