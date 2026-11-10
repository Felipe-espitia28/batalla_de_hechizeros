/**
 * Catálogo de hechizos y definitivos con todos sus números (sección 6 de CLAUDE.md).
 * Es la única fuente de verdad del balance: lo usan el game-server (validar y resolver),
 * la Arena (mostrar maná y cooldowns), la Tienda (precios) y el seed de la tabla `spells`.
 */
import type { AnySpellId, SpellId, SpellKind, UltimateId } from "@duelo/contracts";

/** Prioridad de implementación (sección 2): sirve para mostrar "próximamente" en el catálogo. */
export type Priority = "P0" | "P1" | "P2";

/**
 * Qué hace el Escudo activo del rival con un ataque:
 * - `absorbed`: lo absorbe por completo (sin daño ni efectos) y desaparece.
 * - `halved`: el daño baja a la mitad (redondeado hacia abajo) y desaparece.
 * - `unblockable`: lo ignora; el escudo sigue ahí.
 * `null` en hechizos que no atacan (Escudo, Curación, Renacer).
 */
export type ShieldInteraction = "absorbed" | "halved" | "unblockable";

/**
 * Efectos de un hechizo. Campos opcionales en vez de una unión discriminada porque
 * un hechizo puede combinar varios (Bola de fuego = daño + quemadura).
 */
export interface SpellEffect {
  /** Daño inmediato al rival. */
  damage?: number;
  /** Vida que recupera el lanzador (nunca por encima de la vida máxima). */
  heal?: number;
  /** Duración del escudo propio. */
  shieldDurationMs?: number;
  /** Daño por segundo durante un tiempo (quemadura). */
  burn?: { damagePerSecond: number; durationMs: number };
  /** Daño y drenaje de maná por segundo (veneno). */
  poison?: { damagePerSecond: number; manaDrainPerSecond: number; durationMs: number };
  /** Los cooldowns del rival se multiplican durante un tiempo. */
  freeze?: { cooldownMultiplier: number; durationMs: number };
  /** El rival no puede lanzar nada; mientras tanto regenera maná más rápido. */
  silence?: { durationMs: number; silencedManaRegenPerSecond: number };
  /** Daño por segundo que el escudo no bloquea (Tormenta). */
  storm?: { damagePerSecond: number; durationMs: number };
  /** Elimina quemadura, veneno y efectos negativos del lanzador (Renacer). */
  cleanse?: boolean;
}

interface BaseDefinition {
  name: string;
  emoji: string;
  kind: SpellKind;
  /** Texto para la Tienda y la columna `gesture_description` de la tabla `spells`. */
  gestureDescription: string;
  manaCost: number;
  /** Precio en oro arcano; 0 en los iniciales. */
  price: number;
  /** Lo recibe toda cuenta nueva. */
  isStarter: boolean;
  sortOrder: number;
  priority: Priority;
  /** `null` = sin límite. */
  usesPerMatch: number | null;
  shieldInteraction: ShieldInteraction | null;
  effect: SpellEffect;
}

export interface SpellDefinition extends BaseDefinition {
  id: SpellId;
  kind: "spell";
  /** `null` cuando el límite lo pone `usesPerMatch` (Sello de silencio). */
  cooldownMs: number | null;
}

export interface UltimateDefinition extends BaseDefinition {
  id: UltimateId;
  kind: "ultimate";
  /** Palabras aceptadas ya normalizadas (minúsculas, sin tildes). Basta una. */
  acceptedWords: readonly string[];
  /** Vida máxima del lanzador para poder usarlo (Vacío púrpura). `null` = sin requisito. */
  maxCasterHp: number | null;
}

export const SPELLS = {
  lightning: {
    id: "lightning",
    name: "Rayo",
    emoji: "⚡",
    kind: "spell",
    gestureDescription: "Zigzag de izquierda a derecha",
    manaCost: 10,
    cooldownMs: 1_500,
    price: 0,
    isStarter: true,
    sortOrder: 1,
    priority: "P0",
    usesPerMatch: null,
    shieldInteraction: "absorbed",
    effect: { damage: 10 },
  },
  shield: {
    id: "shield",
    name: "Escudo",
    emoji: "🛡️",
    kind: "spell",
    gestureDescription: "Círculo",
    manaCost: 20,
    cooldownMs: 6_000,
    price: 0,
    isStarter: true,
    sortOrder: 2,
    priority: "P0",
    usesPerMatch: null,
    shieldInteraction: null,
    effect: { shieldDurationMs: 3_000 },
  },
  slash: {
    id: "slash",
    name: "Corte",
    emoji: "🗡️",
    kind: "spell",
    gestureDescription: "Línea recta en cualquier dirección",
    manaCost: 6,
    cooldownMs: 800,
    price: 50,
    isStarter: false,
    sortOrder: 3,
    priority: "P1",
    usesPerMatch: null,
    shieldInteraction: "absorbed",
    effect: { damage: 5 },
  },
  fireball: {
    id: "fireball",
    name: "Bola de fuego",
    emoji: "🔥",
    kind: "spell",
    gestureDescription: "Triángulo",
    manaCost: 25,
    cooldownMs: 4_000,
    price: 100,
    isStarter: false,
    sortOrder: 4,
    priority: "P1",
    usesPerMatch: null,
    shieldInteraction: "absorbed",
    effect: { damage: 15, burn: { damagePerSecond: 2, durationMs: 3_000 } },
  },
  heal: {
    id: "heal",
    name: "Curación",
    emoji: "💚",
    kind: "spell",
    gestureDescription: "V",
    manaCost: 30,
    cooldownMs: 10_000,
    price: 150,
    isStarter: false,
    sortOrder: 5,
    priority: "P1",
    usesPerMatch: null,
    shieldInteraction: null,
    // No quita quemadura ni veneno: por eso no lleva `cleanse`.
    effect: { heal: 15 },
  },
  poison: {
    id: "poison",
    name: "Veneno",
    emoji: "🐍",
    kind: "spell",
    gestureDescription: "S de arriba hacia abajo (plan B: espiral)",
    manaCost: 25,
    cooldownMs: 8_000,
    price: 200,
    isStarter: false,
    sortOrder: 6,
    priority: "P1",
    usesPerMatch: null,
    shieldInteraction: "absorbed",
    effect: { poison: { damagePerSecond: 2, manaDrainPerSecond: 3, durationMs: 6_000 } },
  },
  freeze: {
    id: "freeze",
    name: "Congelar",
    emoji: "❄️",
    kind: "spell",
    gestureDescription: "Cuadrado",
    manaCost: 35,
    cooldownMs: 12_000,
    price: 250,
    isStarter: false,
    sortOrder: 7,
    priority: "P1",
    usesPerMatch: null,
    shieldInteraction: "absorbed",
    effect: { freeze: { cooldownMultiplier: 2, durationMs: 5_000 } },
  },
  "silence-seal": {
    id: "silence-seal",
    name: "Sello de silencio",
    emoji: "✖️",
    kind: "spell",
    gestureDescription: "X con los dos índices, sostenida 0,7 s",
    manaCost: 70,
    cooldownMs: null,
    price: 400,
    isStarter: false,
    sortOrder: 8,
    priority: "P2",
    usesPerMatch: 1,
    shieldInteraction: "absorbed",
    effect: { silence: { durationMs: 7_000, silencedManaRegenPerSecond: 8 } },
  },
} as const satisfies Record<SpellId, SpellDefinition>;

/** Todos los definitivos cuestan el maná lleno (100). */
const ULTIMATE_MANA_COST = 100;

export const ULTIMATES = {
  meteor: {
    id: "meteor",
    name: "Meteoro",
    emoji: "☄️",
    kind: "ultimate",
    gestureDescription: "Grita «Meteoro»",
    manaCost: ULTIMATE_MANA_COST,
    price: 0,
    isStarter: true,
    sortOrder: 9,
    priority: "P1",
    usesPerMatch: null,
    acceptedWords: ["meteoro"],
    maxCasterHp: null,
    // Contra Escudo: 35 → 17 (mitad redondeada hacia abajo).
    shieldInteraction: "halved",
    effect: { damage: 35 },
  },
  storm: {
    id: "storm",
    name: "Tormenta",
    emoji: "🌪️",
    kind: "ultimate",
    gestureDescription: "Grita «Tormenta»",
    manaCost: ULTIMATE_MANA_COST,
    price: 300,
    isStarter: false,
    sortOrder: 10,
    priority: "P2",
    usesPerMatch: null,
    acceptedWords: ["tormenta"],
    maxCasterHp: null,
    shieldInteraction: "unblockable",
    effect: { storm: { damagePerSecond: 8, durationMs: 5_000 } },
  },
  rebirth: {
    id: "rebirth",
    name: "Renacer",
    emoji: "✨",
    kind: "ultimate",
    gestureDescription: "Grita «Renacer»",
    manaCost: ULTIMATE_MANA_COST,
    price: 300,
    isStarter: false,
    sortOrder: 11,
    priority: "P2",
    usesPerMatch: null,
    acceptedWords: ["renacer"],
    maxCasterHp: null,
    shieldInteraction: null,
    effect: { heal: 40, cleanse: true },
  },
  "purple-void": {
    id: "purple-void",
    name: "Vacío púrpura",
    emoji: "🟣",
    kind: "ultimate",
    gestureDescription: "Grita «Vacío» o «Púrpura» con 30 de vida o menos",
    manaCost: ULTIMATE_MANA_COST,
    price: 500,
    isStarter: false,
    sortOrder: 12,
    priority: "P2",
    usesPerMatch: 1,
    acceptedWords: ["vacio", "purpura"],
    maxCasterHp: 30,
    // Contra Escudo: 50 → 25.
    shieldInteraction: "halved",
    effect: { damage: 50 },
  },
} as const satisfies Record<UltimateId, UltimateDefinition>;

/** Hechizos que recibe toda cuenta nueva (sección 6, Economía). */
export const STARTER_SPELL_IDS: readonly AnySpellId[] = ["lightning", "shield", "meteor"];

/** Reglas del grimorio (sección 6, Grimorio). */
export const GRIMOIRE_RULES = {
  slotCount: 4,
  /** Espacios 1 y 2, siempre fijos. */
  fixedSpellIds: ["lightning", "shield"],
  defaultUltimateId: "meteor",
} as const satisfies {
  slotCount: number;
  fixedSpellIds: readonly SpellId[];
  defaultUltimateId: UltimateId;
};

export function getSpell(id: SpellId): SpellDefinition {
  return SPELLS[id];
}

export function getUltimate(id: UltimateId): UltimateDefinition {
  return ULTIMATES[id];
}

/** Daño contra un Escudo que lo reduce a la mitad: siempre redondeado hacia abajo. */
export function halveDamage(damage: number): number {
  return Math.floor(damage / 2);
}
