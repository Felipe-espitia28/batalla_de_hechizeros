/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_REMOTE_ARENA_URL?: string;
  readonly VITE_REMOTE_TIENDA_URL?: string;
  readonly VITE_REMOTE_RANKING_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
