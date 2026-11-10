/**
 * Sesión del jugador: { token, user } (Session de @duelo/contracts).
 * Se guarda en localStorage para sobrevivir a recargas; es el único estado que el shell
 * comparte con los remotes, y lo hace por props, nunca como store global (sección 9).
 */
import type { Session } from "@duelo/contracts";

export const SESSION_KEY = "duelo:session";

/** Subconjunto de Storage: permite probar sin navegador. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Lee el `exp` del JWT sin verificar la firma: solo sirve para no mostrar una sesión ya vencida. */
export function tokenExpiresAt(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function isSession(value: unknown): value is Session {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<Session>;
  return (
    typeof v.token === "string" &&
    typeof v.user === "object" &&
    v.user !== null &&
    typeof v.user.id === "string" &&
    typeof v.user.username === "string"
  );
}

export function loadSession(store: KeyValueStore, now = Date.now()): Session | null {
  try {
    const raw = store.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSession(parsed)) {
      store.removeItem(SESSION_KEY);
      return null;
    }
    const expiresAt = tokenExpiresAt(parsed.token);
    if (expiresAt !== null && expiresAt <= now) {
      store.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    // Almacenamiento bloqueado o JSON corrupto: se empieza sin sesión.
    return null;
  }
}

export function saveSession(store: KeyValueStore, session: Session): void {
  try {
    store.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Modo privado sin almacenamiento: la sesión dura lo que dure la pestaña.
  }
}

export function clearSession(store: KeyValueStore): void {
  try {
    store.removeItem(SESSION_KEY);
  } catch {
    // Nada que limpiar.
  }
}
