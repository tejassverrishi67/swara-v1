/**
 * Loads `swara/.env` into `process.env` before anything reads {@link CONFIG}.
 * ========================================================================
 *
 * Why this file exists: `.env.example` documents the backend's environment
 * variables, but nothing actually loaded a `.env` file — there is no `dotenv`
 * dependency and `tsx` does not auto-load one. So every key in `.env` was being
 * silently ignored. This module closes that gap with zero dependencies, using
 * Node's built-in `process.loadEnvFile` (Node >= 20.12 / 21.7; the project runs
 * Node >= 20).
 *
 * It must be the FIRST import in `server.ts` so it runs before
 * `import { CONFIG } from "./lib/config.ts"` (ES module imports evaluate in
 * order). It is deliberately NOT imported by the test setup — tests run in mock
 * mode and must not pick up a developer's local keys.
 *
 * Values already present in the real environment take precedence: we only fill
 * in keys that are not already set.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

type EnvLoader = (path?: string) => void;

/** Candidate locations, in priority order. `../.env` = the workspace root (`swara/.env`). */
const CANDIDATES = ["../.env", "./.env"];

function loadDotEnv(): void {
  const loader = (process as unknown as { loadEnvFile?: EnvLoader }).loadEnvFile;

  for (const rel of CANDIDATES) {
    const path = fileURLToPath(new URL(rel, import.meta.url));
    if (!existsSync(path)) continue;

    if (typeof loader === "function") {
      try {
        // Snapshot keys that were already set in the real environment so we can
        // restore them — process.loadEnvFile overwrites.
        const preset = { ...process.env };
        loader(path);
        for (const [key, value] of Object.entries(preset)) {
          if (value !== undefined) process.env[key] = value;
        }
      } catch (err) {
        console.warn(`[load-env] failed to load ${path}:`, err);
      }
    } else {
      console.warn(
        `[load-env] found ${path} but this Node build lacks process.loadEnvFile. ` +
          `Start the server with:  node --env-file=.env --import tsx server.ts`,
      );
    }
    return;
  }
}

loadDotEnv();
