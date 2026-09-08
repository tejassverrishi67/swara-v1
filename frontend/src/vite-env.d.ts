/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin. See ../../.env.example. */
  readonly VITE_API_BASE?: string;
  /** Build identifier recorded into provenance meta (Features.md F-04). */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
