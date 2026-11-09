/**
 * Comunicación entre micro frontends (sección 9 de CLAUDE.md).
 * - Shell → remotes: props del componente `App` de cada remote.
 * - Remotes → shell u otros remotes: CustomEvent del navegador con prefijo `duelo:`.
 * Nada de estado global compartido: estos tipos son todo el acoplamiento permitido.
 */
import type { MatchId } from "./common.js";
import type { SessionUser } from "./rest.js";

export interface Session {
  token: string;
  user: SessionUser;
}

/** Props que el shell pasa al `App` expuesto por cada remote. */
export interface RemoteAppProps {
  session: Session;
  /** Solo el shell enruta; los remotes piden navegar con esto (p. ej. "/ranking"). */
  navigate: (path: string) => void;
}

/** Mapa evento → payload (`event.detail`). */
export interface DueloEventMap {
  "duelo:gold-changed": { gold: number };
  "duelo:match-ended": { matchId: MatchId; newRating: number };
  "duelo:session-expired": Record<string, never>;
}

export type DueloEventName = keyof DueloEventMap;

export const DUELO_EVENTS = {
  goldChanged: "duelo:gold-changed",
  matchEnded: "duelo:match-ended",
  sessionExpired: "duelo:session-expired",
} as const satisfies Record<string, DueloEventName>;

/** Emite un CustomEvent tipado en `window`. */
export function emitDueloEvent<K extends DueloEventName>(name: K, detail: DueloEventMap[K]): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Escucha un CustomEvent tipado y devuelve la función para dejar de escuchar,
 * pensada para el cleanup de un `useEffect`.
 */
export function onDueloEvent<K extends DueloEventName>(
  name: K,
  handler: (detail: DueloEventMap[K]) => void,
): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<DueloEventMap[K]>).detail);
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}
