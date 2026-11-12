/**
 * Simulador de la arena de entrenamiento: el jugador contra un muñeco que no ataca.
 *
 * Corre solo en el navegador y no da oro ni rating. En una partida real el que decide es el
 * game-server (sección 4: servidor autoritativo); esto solo sirve para practicar los gestos y
 * ver qué haría cada hechizo. Por eso imita las validaciones del motor del servidor
 * (services/game-server/src/combat/engine.ts) y toma todos los números de @duelo/game-rules:
 * lo que se aprende aquí es lo mismo que pasa en combate.
 *
 * Diferencias a propósito con la partida:
 * - los límites de "1 vez por partida" no aplican, para poder repetir;
 * - el Vacío púrpura no exige vida ≤ 30 (el mensaje lo recuerda);
 * - el muñeco no tiene escudo ni ataca, y al llegar a 0 vuelve a 100.
 *
 * Funciones deterministas: reciben `now` explícito y mutan el estado, para probarlas sin reloj.
 */
import type { AnySpellId, EffectType, PlayerState, RejectionCode, SpellId, UltimateId } from "@duelo/contracts";
import {
  MATCH_RULES,
  SPELLS,
  ULTIMATES,
  transcriptMatchesUltimate,
  type SpellDefinition,
  type UltimateDefinition,
} from "@duelo/game-rules";

/** Efecto con duración y su contabilidad de golpes por segundo (solo { type, until } se dibuja). */
interface PracticeEffect {
  type: EffectType;
  until: number;
  nextTickAt: number;
  damagePerSecond: number;
  manaDrainPerSecond: number;
}

export interface PracticeFighter {
  hp: number;
  /** Con decimales (+0,4 por tick); se dibuja redondeado hacia abajo. */
  mana: number;
  shieldUntil: number | null;
  effects: PracticeEffect[];
  cooldownsUntil: Partial<Record<AnySpellId, number>>;
  silencedUntil: number | null;
}

export interface PracticeStats {
  /** Hechizos y definitivos aceptados. */
  casts: number;
  /** Gestos por debajo de la confianza mínima. */
  failed: number;
  /** Veces que el muñeco llegó a 0. */
  kos: number;
}

export interface PracticeState {
  player: PracticeFighter;
  dummy: PracticeFighter;
  grimoire: ReadonlySet<SpellId>;
  ultimateId: UltimateId;
  infiniteMana: boolean;
  lastAdvancedAt: number;
  lastCastAt: number | null;
  penaltyUntil: number | null;
  sealChargingSince: number | null;
  stats: PracticeStats;
}

export type PracticeResult =
  | { ok: true; outcome: "hit" | "self"; damage: number }
  | { ok: false; code: RejectionCode };

const reject = (code: RejectionCode) => ({ ok: false, code }) as const;

function newFighter(): PracticeFighter {
  return {
    hp: MATCH_RULES.maxHp,
    mana: MATCH_RULES.startingMana,
    shieldUntil: null,
    effects: [],
    cooldownsUntil: {},
    silencedUntil: null,
  };
}

export function createPractice(grimoire: readonly SpellId[], ultimateId: UltimateId, now: number): PracticeState {
  return {
    player: newFighter(),
    dummy: newFighter(),
    grimoire: new Set(grimoire),
    ultimateId,
    infiniteMana: false,
    lastAdvancedAt: now,
    lastCastAt: null,
    penaltyUntil: null,
    sealChargingSince: null,
    stats: { casts: 0, failed: 0, kos: 0 },
  };
}

/** El loadout llega del api después de abrir la práctica: se actualiza sin reiniciar. */
export function setLoadout(state: PracticeState, grimoire: readonly SpellId[], ultimateId: UltimateId): void {
  state.grimoire = new Set(grimoire);
  state.ultimateId = ultimateId;
}

export function setInfiniteMana(state: PracticeState, enabled: boolean): void {
  state.infiniteMana = enabled;
  if (enabled) state.player.mana = MATCH_RULES.maxMana;
}

export function resetDummy(state: PracticeState): void {
  state.dummy = newFighter();
}

const isActive = (until: number | null, now: number) => until !== null && now < until;

/**
 * Avanza hasta `now`: regenera maná, aplica los golpes por segundo y vence escudos,
 * silencios y efectos. Si el muñeco cae, cuenta un KO y vuelve a 100.
 */
export function advance(state: PracticeState, now: number): void {
  const from = state.lastAdvancedAt;
  if (now <= from) return;
  state.lastAdvancedAt = now;

  for (const fighter of [state.player, state.dummy]) {
    // Sellado regenera más rápido, como en la partida.
    const regen = isActive(fighter.silencedUntil, from)
      ? SPELLS["silence-seal"].effect.silence.silencedManaRegenPerSecond
      : MATCH_RULES.manaRegenPerSecond;
    fighter.mana = Math.min(MATCH_RULES.maxMana, fighter.mana + (regen * (now - from)) / 1000);

    for (const effect of fighter.effects) {
      while (effect.nextTickAt <= now && effect.nextTickAt <= effect.until) {
        fighter.hp = Math.max(0, fighter.hp - effect.damagePerSecond);
        fighter.mana = Math.max(0, fighter.mana - effect.manaDrainPerSecond);
        effect.nextTickAt += 1_000;
      }
    }
    fighter.effects = fighter.effects.filter((effect) => effect.until > now);
    if (fighter.shieldUntil !== null && now >= fighter.shieldUntil) fighter.shieldUntil = null;
    if (fighter.silencedUntil !== null && now >= fighter.silencedUntil) fighter.silencedUntil = null;
  }

  if (state.infiniteMana) state.player.mana = MATCH_RULES.maxMana;
  if (state.dummy.hp <= 0) {
    state.stats.kos += 1;
    resetDummy(state);
  }
}

/** Un efecto nuevo del mismo tipo renueva la duración en vez de acumularse. */
function addEffect(target: PracticeFighter, type: EffectType, now: number, durationMs: number, dps = 0, drain = 0): void {
  target.effects = target.effects.filter((effect) => effect.type !== type);
  target.effects.push({ type, until: now + durationMs, nextTickAt: now + 1_000, damagePerSecond: dps, manaDrainPerSecond: drain });
}

/** Aplica un hechizo o definitivo ya aceptado (sin escudo en el muñeco: siempre impacta). */
function resolve(state: PracticeState, def: SpellDefinition | UltimateDefinition, now: number): PracticeResult {
  const { player, dummy } = state;
  const effect = def.effect;

  if (def.shieldInteraction === null) {
    // Escudo, Curación y Renacer: sobre el propio jugador.
    if (effect.shieldDurationMs) player.shieldUntil = now + effect.shieldDurationMs;
    if (effect.heal) player.hp = Math.min(MATCH_RULES.maxHp, player.hp + effect.heal);
    if (effect.cleanse) player.effects = [];
    return { ok: true, outcome: "self", damage: 0 };
  }

  const damage = effect.damage ?? 0;
  dummy.hp = Math.max(0, dummy.hp - damage);
  if (effect.burn) addEffect(dummy, "burn", now, effect.burn.durationMs, effect.burn.damagePerSecond);
  if (effect.poison) {
    addEffect(dummy, "poison", now, effect.poison.durationMs, effect.poison.damagePerSecond, effect.poison.manaDrainPerSecond);
  }
  if (effect.freeze) addEffect(dummy, "freeze", now, effect.freeze.durationMs);
  if (effect.storm) addEffect(dummy, "storm", now, effect.storm.durationMs, effect.storm.damagePerSecond);
  if (effect.silence) dummy.silencedUntil = now + effect.silence.durationMs;
  return { ok: true, outcome: "hit", damage };
}

/** Lo que un gesto o grito no puede saltarse: intervalo mínimo y penalización por fallo. */
function checkTiming(state: PracticeState, now: number): RejectionCode | null {
  const tooSoon = state.lastCastAt !== null && now - state.lastCastAt < MATCH_RULES.minCastIntervalMs;
  if (tooSoon || isActive(state.penaltyUntil, now)) return "RATE_LIMIT";
  return null;
}

function pay(state: PracticeState, manaCost: number): boolean {
  if (state.infiniteMana) return true;
  if (state.player.mana < manaCost) return false;
  state.player.mana -= manaCost;
  return true;
}

/** Hechizo dibujado. Mismo orden de validaciones que el servidor; ningún rechazo gasta maná. */
export function castSpell(state: PracticeState, spellId: SpellId, confidence: number, now: number): PracticeResult {
  advance(state, now);
  if (!state.grimoire.has(spellId)) return reject("NOT_IN_GRIMOIRE");
  const timing = checkTiming(state, now);
  if (timing) return reject(timing);
  state.lastCastAt = now;

  if (confidence < MATCH_RULES.minConfidence) {
    state.penaltyUntil = now + MATCH_RULES.failedCastPenaltyMs;
    state.stats.failed += 1;
    return reject("LOW_CONFIDENCE");
  }

  const def: SpellDefinition = SPELLS[spellId];
  if (isActive(state.player.cooldownsUntil[spellId] ?? null, now)) return reject("COOLDOWN");
  if (spellId === "silence-seal") {
    const charged = state.sealChargingSince !== null && now - state.sealChargingSince >= MATCH_RULES.sealMinChargeMs;
    if (!charged) return reject("SEAL_NOT_CHARGED");
  }
  if (!pay(state, def.manaCost)) return reject("NO_MANA");

  if (def.cooldownMs !== null) state.player.cooldownsUntil[spellId] = now + def.cooldownMs;
  if (spellId === "silence-seal") state.sealChargingSince = null;
  state.stats.casts += 1;
  return resolve(state, def, now);
}

/** Gesto que el reconocedor no aceptó (confianza < 0,80): cuenta como fallo y penaliza. */
export function failSpell(state: PracticeState, now: number): void {
  state.penaltyUntil = now + MATCH_RULES.failedCastPenaltyMs;
  state.stats.failed += 1;
}

/** Definitivo gritado: maná lleno y palabra correcta, igual que en partida. */
export function castUltimate(state: PracticeState, ultimateId: UltimateId, transcript: string, now: number): PracticeResult {
  advance(state, now);
  if (ultimateId !== state.ultimateId) return reject("NOT_IN_GRIMOIRE");
  const timing = checkTiming(state, now);
  if (timing) return reject(timing);
  state.lastCastAt = now;

  if (!transcriptMatchesUltimate(ultimateId, transcript)) return reject("LOW_CONFIDENCE");
  const def: UltimateDefinition = ULTIMATES[ultimateId];
  if (!pay(state, def.manaCost)) return reject("NO_MANA");
  state.stats.casts += 1;
  return resolve(state, def, now);
}

/** La X del Sello se formó: empieza la carga (≥ 0,6 s antes de lanzar). */
export function sealCharging(state: PracticeState, now: number): void {
  state.sealChargingSince ??= now;
}

export function sealCancel(state: PracticeState): void {
  state.sealChargingSince = null;
}

/** Forma de `match:state` para reutilizar PlayerPanel tal cual. */
export function toPlayerState(fighter: PracticeFighter, now: number): PlayerState {
  const cooldownsUntil: Partial<Record<AnySpellId, number>> = {};
  for (const [id, until] of Object.entries(fighter.cooldownsUntil)) {
    if (until !== undefined && until > now) cooldownsUntil[id as AnySpellId] = until;
  }
  return {
    hp: fighter.hp,
    mana: Math.floor(fighter.mana),
    shieldUntil: isActive(fighter.shieldUntil, now) ? fighter.shieldUntil : null,
    effects: fighter.effects.filter((e) => e.until > now).map(({ type, until }) => ({ type, until })),
    cooldownsUntil,
    silencedUntil: isActive(fighter.silencedUntil, now) ? fighter.silencedUntil : null,
    used: { "silence-seal": false, "purple-void": false },
  };
}
