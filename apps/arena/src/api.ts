/**
 * Llamadas de la Arena al api REST. Solo dos, ambas con el JWT de la sesión que da el shell:
 *   - GET /me            → oro actualizado tras la partida (para duelo:gold-changed).
 *   - GET /me/inventory  → grimorio, para limitar las plantillas del $1 (sección 6).
 * Un 401 significa que la sesión ya no sirve: se avisa al shell con duelo:session-expired
 * y él lleva al login (sección 9). Cualquier otro fallo se trata en quien llama.
 */
import {
  emitDueloEvent,
  type ApiErrorBody,
  type InventoryResponse,
  type MeResponse,
  type SpellId,
} from "@duelo/contracts";
import { API_URL, DEFAULT_GRIMOIRE } from "./config";

export class ApiUnavailableError extends Error {}

async function getJson<T>(path: string, token: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  if (!API_URL) throw new ApiUnavailableError("Falta VITE_API_URL en la Arena");
  let response: Response;
  try {
    response = await fetchImpl(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    // Render free dormido o sin red: no es culpa de la sesión.
    throw new ApiUnavailableError(`api inalcanzable: ${(error as Error).message}`);
  }
  if (response.status === 401) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    emitDueloEvent("duelo:session-expired", {});
    throw new ApiUnavailableError(body?.error.message ?? "Sesión expirada");
  }
  if (!response.ok) throw new ApiUnavailableError(`${path} respondió ${response.status}`);
  return (await response.json()) as T;
}

/** Oro actual del jugador, o null si el api no respondió (el shell lo actualizará al recargar /me). */
export async function fetchGold(token: string, fetchImpl?: typeof fetch): Promise<number | null> {
  try {
    const me = await getJson<MeResponse>("/me", token, fetchImpl);
    return me.gold;
  } catch {
    return null;
  }
}

/**
 * Hechizos del grimorio. Mientras GET /me/inventory no exista (o falle), Rayo y Escudo,
 * que siempre están en los espacios 1 y 2. El servidor NO recibe esto: consulta el loadout por su cuenta.
 */
export async function fetchGrimoire(token: string, fetchImpl?: typeof fetch): Promise<SpellId[]> {
  try {
    const inventory = await getJson<InventoryResponse>("/me/inventory", token, fetchImpl);
    const spells = inventory.grimoire.slots.filter((s): s is SpellId => s !== null);
    return spells.length > 0 ? spells : [...DEFAULT_GRIMOIRE];
  } catch {
    return [...DEFAULT_GRIMOIRE];
  }
}
