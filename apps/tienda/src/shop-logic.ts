/**
 * Lógica de la Tienda sin React: qué se puede comprar, qué va en cada espacio del grimorio
 * y cómo se describe cada hechizo. Los números salen de @duelo/game-rules, la misma fuente
 * que usa el game-server, para que la Tienda nunca prometa algo distinto a lo que pasa en combate.
 */
import type { AnySpellId, Grimoire, SpellCatalogItem, SpellId, UltimateId } from "@duelo/contracts";
import { SPELL_IDS, ULTIMATE_IDS } from "@duelo/contracts";
import { GRIMOIRE_RULES, SPELLS, ULTIMATES, type SpellDefinition, type UltimateDefinition } from "@duelo/game-rules";

export type SpellStatus =
  /** Inicial: viene con la cuenta. */
  | "starter"
  | "owned"
  | "affordable"
  | "too-expensive";

const spellIds: readonly string[] = SPELL_IDS;
const ultimateIds: readonly string[] = ULTIMATE_IDS;

export function isSpellId(id: string): id is SpellId {
  return spellIds.includes(id);
}

export function isUltimateId(id: string): id is UltimateId {
  return ultimateIds.includes(id);
}

export function getDefinition(id: AnySpellId): SpellDefinition | UltimateDefinition {
  return isSpellId(id) ? SPELLS[id] : ULTIMATES[id];
}

export function getSpellStatus(item: SpellCatalogItem, owned: ReadonlySet<string>, gold: number): SpellStatus {
  if (owned.has(item.id)) return item.isStarter ? "starter" : "owned";
  // Los P2 (Sello, Tormenta, Renacer, Vacío púrpura) ya los resuelve el game-server:
  // se venden igual que el resto.
  return gold >= item.price ? "affordable" : "too-expensive";
}

const seconds = (ms: number) => `${(ms / 1000).toLocaleString("es-CO")} s`;

/** Resumen corto del efecto, armado desde los números de game-rules. */
export function describeEffect(def: SpellDefinition | UltimateDefinition): string {
  const { effect } = def;
  const parts: string[] = [];
  if (effect.damage) parts.push(`${effect.damage} de daño`);
  if (effect.heal) parts.push(`+${effect.heal} de vida`);
  if (effect.shieldDurationMs) parts.push(`absorbe el siguiente ataque durante ${seconds(effect.shieldDurationMs)}`);
  if (effect.burn) parts.push(`quemadura de ${effect.burn.damagePerSecond}/s durante ${seconds(effect.burn.durationMs)}`);
  if (effect.poison) {
    parts.push(
      `${effect.poison.damagePerSecond} de daño y −${effect.poison.manaDrainPerSecond} de maná por segundo durante ${seconds(effect.poison.durationMs)}`,
    );
  }
  if (effect.freeze) {
    parts.push(`los cooldowns del rival duran ×${effect.freeze.cooldownMultiplier} durante ${seconds(effect.freeze.durationMs)}`);
  }
  if (effect.silence) parts.push(`el rival no puede lanzar nada durante ${seconds(effect.silence.durationMs)}`);
  if (effect.storm) {
    parts.push(`${effect.storm.damagePerSecond} de daño/s durante ${seconds(effect.storm.durationMs)}, no se bloquea`);
  }
  if (effect.cleanse) parts.push("elimina quemadura, veneno y efectos negativos");
  const text = parts.join("; ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Datos de combate en una línea: maná, cooldown y límites de uso. */
export function describeStats(def: SpellDefinition | UltimateDefinition): string {
  const stats = [`${def.manaCost} de maná`];
  if (def.kind === "spell" && def.cooldownMs !== null) stats.push(`cooldown ${seconds(def.cooldownMs)}`);
  if (def.usesPerMatch !== null) stats.push(`${def.usesPerMatch} vez por partida`);
  if (def.kind === "ultimate" && def.maxCasterHp !== null) stats.push(`solo con ${def.maxCasterHp} de vida o menos`);
  return stats.join(" · ");
}

const fixedIds: readonly string[] = GRIMOIRE_RULES.fixedSpellIds;

/**
 * Hechizos que se pueden elegir para un espacio libre (3 o 4): comprados, que no sean los fijos
 * y que no estén ya en el otro espacio libre. Así el selector nunca ofrece algo que el api rechace.
 */
export function slotOptions(owned: ReadonlySet<string>, grimoire: Grimoire, slotIndex: 2 | 3): SpellId[] {
  const otherSlot = grimoire.slots[slotIndex === 2 ? 3 : 2];
  return SPELL_IDS.filter((id) => owned.has(id) && !fixedIds.includes(id) && id !== otherSlot).sort(
    (a, b) => SPELLS[a].sortOrder - SPELLS[b].sortOrder,
  );
}

export function ultimateOptions(owned: ReadonlySet<string>): UltimateId[] {
  return ULTIMATE_IDS.filter((id) => owned.has(id)).sort((a, b) => ULTIMATES[a].sortOrder - ULTIMATES[b].sortOrder);
}

export function sameGrimoire(a: Grimoire, b: Grimoire): boolean {
  return a.ultimateId === b.ultimateId && a.slots.every((spellId, index) => spellId === b.slots[index]);
}

/** Convierte los `details` de INVALID_GRIMOIRE ({ field, message }[]) en mensajes por campo. */
export function grimoireErrorsByField(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) return {};
  const errors: Record<string, string> = {};
  for (const problem of details) {
    if (
      typeof problem === "object" &&
      problem !== null &&
      typeof (problem as { field?: unknown }).field === "string" &&
      typeof (problem as { message?: unknown }).message === "string"
    ) {
      const { field, message } = problem as { field: string; message: string };
      errors[field] ??= message;
    }
  }
  return errors;
}
