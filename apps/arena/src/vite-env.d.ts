/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_GAME_SERVER_URL?: string;
  /** WebSocket del agente local (R2); lo usa LocalAgentSource. */
  readonly VITE_LOCAL_AGENT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
