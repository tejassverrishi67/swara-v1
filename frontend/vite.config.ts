import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/**
 * `@swara/shared` is resolved directly to the sibling workspace's source so the
 * frontend and backend share one definition with no build step.
 *
 * `envDir` points at the workspace root so the frontend reads the SAME
 * `swara/.env` file the backend does — one env file for the whole project.
 * Only `VITE_`-prefixed vars are exposed to the browser bundle; provider keys
 * (LLM_API_KEY, SARVAM_API_KEY, …) are never sent to the client.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: fileURLToPath(new URL("..", import.meta.url)),
  resolve: {
    alias: {
      "@swara/shared": fileURLToPath(new URL("../shared/types.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
