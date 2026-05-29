import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Mirrors the `@/*` → `./*` path alias from tsconfig.json so unit tests can
// import lib helpers the same way the app does. Node environment is enough:
// the helpers under test are pure (JSONL parsing, crop-path joining). Hooks
// that touch React/Firebase are exercised by the live dry-run, not unit tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
