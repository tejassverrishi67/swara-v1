import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The backend imports `@swara/shared` (the sibling workspace). npm workspaces
 * symlink it into node_modules, but we also alias it here so tests resolve it
 * even before `npm install` has linked the workspace.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@swara/shared": fileURLToPath(new URL("../shared/types.ts", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.test.ts", "api/**/*.test.ts"],
    environment: "node",
  },
});
