/**
 * Grimorio del jugador, solo para saber contra qué plantillas comparar el $1 y qué mostrar.
 * El servidor NO lo recibe del cliente: lo consulta al api por su cuenta (sección 6).
 */
import { emitDueloEvent, type InventoryResponse, type SpellId } from "@duelo/contracts";
import { API_URL, DEFAULT_GRIMOIRE } from "./config";

export async function fetchGrimoire(token: string): Promise<SpellId[]> {
  if (!API_URL) return [...DEFAULT_GRIMOIRE];
  try {
    const response = await fetch(`${API_URL}/me/inventory`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) {
      emitDueloEvent("duelo:session-expired", {});
      return [...DEFAULT_GRIMOIRE];
    }
    if (!response.ok) return [...DEFAULT_GRIMOIRE];
    const body = (await response.json()) as InventoryResponse;
    return body.grimoire.slots.filter((s): s is SpellId => s !== null);
  } catch {
    // Si el api no responde (p. ej. Render dormido) se juega con Rayo y Escudo, que siempre están.
    return [...DEFAULT_GRIMOIRE];
  }
}
