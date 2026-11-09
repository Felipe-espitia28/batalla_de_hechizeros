/**
 * Reglas del grimorio (sección 6 de CLAUDE.md, Grimorio) como funciones puras.
 * Están separadas del servicio para probarlas sin base de datos y para que el loadout del
 * game-server y el inventario de la Tienda armen el grimorio exactamente igual.
 */
import {
  SPELL_IDS,
  ULTIMATE_IDS,
  type Grimoire,
  type SpellId,
  type UltimateId,
} from "@duelo/contracts";
import { GRIMOIRE_RULES } from "@duelo/game-rules";

export interface GrimoireProblem {
  /** Campo con el problema, en la misma notación que los errores de validación ("slots.2"). */
  field: string;
  message: string;
}

/** Lo que llega en PUT /me/grimoire después de validar la forma con zod. */
export interface GrimoireInput {
  slots: (string | null)[];
  ultimateId: string;
}

const spellIds: readonly string[] = SPELL_IDS;
const ultimateIds: readonly string[] = ULTIMATE_IDS;

export function isSpellId(id: string): id is SpellId {
  return spellIds.includes(id);
}

export function isUltimateId(id: string): id is UltimateId {
  return ultimateIds.includes(id);
}

/**
 * Revisa todas las reglas y devuelve todos los problemas a la vez (no solo el primero),
 * para que la Tienda pueda marcar cada espacio inválido en una sola respuesta.
 * `owned` son los ids del inventario del jugador.
 */
export function findGrimoireProblems(input: GrimoireInput, owned: ReadonlySet<string>): GrimoireProblem[] {
  const problems: GrimoireProblem[] = [];
  const { slotCount, fixedSpellIds } = GRIMOIRE_RULES;

  if (input.slots.length !== slotCount) {
    problems.push({ field: "slots", message: `El grimorio tiene exactamente ${slotCount} espacios` });
    return problems;
  }

  // Espacios 1 y 2: siempre Rayo y Escudo. Se exigen explícitos (en vez de ignorarlos) para que
  // un cliente desactualizado se entere en lugar de guardar algo distinto de lo que muestra.
  fixedSpellIds.forEach((fixedId, index) => {
    if (input.slots[index] !== fixedId) {
      problems.push({ field: `slots.${index}`, message: `El espacio ${index + 1} siempre es ${fixedId}` });
    }
  });

  const seen = new Set<string>(fixedSpellIds);
  input.slots.slice(fixedSpellIds.length).forEach((spellId, offset) => {
    if (spellId === null) return;
    const index = fixedSpellIds.length + offset;
    const field = `slots.${index}`;
    if (!isSpellId(spellId)) {
      // Incluye los definitivos: van en su propio espacio, no en los 4 de hechizos.
      problems.push({ field, message: `"${spellId}" no es un hechizo que vaya en el grimorio` });
    } else if (seen.has(spellId)) {
      problems.push({ field, message: `"${spellId}" ya está en otro espacio` });
    } else if (!owned.has(spellId)) {
      problems.push({ field, message: `No tienes "${spellId}": cómpralo primero en la Tienda` });
    }
    seen.add(spellId);
  });

  if (!isUltimateId(input.ultimateId)) {
    problems.push({ field: "ultimateId", message: `"${input.ultimateId}" no es un definitivo` });
  } else if (!owned.has(input.ultimateId)) {
    problems.push({ field: "ultimateId", message: `No tienes "${input.ultimateId}": cómpralo primero en la Tienda` });
  }

  return problems;
}

/**
 * Arma el grimorio desde las filas de `grimoire_slots`. Los espacios 1 y 2 se fuerzan a Rayo y
 * Escudo aunque falten filas (cuentas creadas antes del registro con grimorio inicial):
 * un jugador nunca debe quedarse sin sus hechizos P0 por un dato viejo.
 */
export function buildGrimoire(
  rows: readonly { slot: number; spellId: string }[],
  equippedUltimateId: string,
): Grimoire {
  const bySlot = new Map(rows.map((row) => [row.slot, row.spellId]));
  const optionalSlot = (slot: number): SpellId | null => {
    const spellId = bySlot.get(slot);
    return spellId !== undefined && isSpellId(spellId) ? spellId : null;
  };
  return {
    slots: [GRIMOIRE_RULES.fixedSpellIds[0], GRIMOIRE_RULES.fixedSpellIds[1], optionalSlot(3), optionalSlot(4)],
    ultimateId: isUltimateId(equippedUltimateId) ? equippedUltimateId : GRIMOIRE_RULES.defaultUltimateId,
  };
}

/** Hechizos del grimorio sin los espacios vacíos, en el orden de los espacios (forma del loadout). */
export function grimoireSpells(grimoire: Grimoire): SpellId[] {
  return grimoire.slots.filter((spellId): spellId is SpellId => spellId !== null);
}
