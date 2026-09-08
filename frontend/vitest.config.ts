import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Frontend unit tests. Currently only the pure `session-flow` reducer/guard is
 * covered — the safety-critical rules the bug-fixing pass has to verify
 * (approval gating, no auto-instant, ambiguity never auto-advances). No DOM is
 * needed for those, so the environment stays "node".
 */
export default defineConfig({
  resolve: {
    alias: {
      "@swara/shared": fileURLToPath(new URL("../shared/types.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
