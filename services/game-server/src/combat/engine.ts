/**
 * Motor de combate: reglas del servidor autoritativo sin red, sin reloj y sin Redis.
 *
 * Todas las funciones reciben el estado y el instante `now` explícitos y lo modifican en el sitio.
 * No son "puras" en sentido estricto (mutan), pero son deterministas: mismo estado + mismo `now`
 * = mismo resultado. Eso permite probar cada regla con tests unitarios avanzando el tiempo a mano,
 * y la capa de sockets solo traduce eventos a llamadas de este módulo.
 *
 * Ningún número de balance se escribe aquí: todos salen de @duelo/game-rules (SPELLS, ULTIMATES,
 * MATCH_RULES). Este archivo solo decide *cómo* se aplican (sección 6, Interacciones).
 */
import type {
  ActiveEffect,
  AnySpellId,
  EffectType,
  EndReason,
  MatchId,
  MatchState,
  MatchStatus,
  PlayerState,
  RejectionCode,
  SpellId,
  SpellOutcome,
  UltimateId,
  UserId,
} from "@duelo/contracts";
import {
  MATCH_RULES,
  SPELLS,
  ULTIMATES,
  halveDamage,
  transcriptMatchesUltimate,
  type MatchRules,
  type SpellDefinition,
  type UltimateDefinition,
} from "@duelo/game-rules";

/**
 * Hechizos con efecto implementado. Un hechizo del grimorio que no esté aquí se descarta al cargar
 * el loadout y responde NOT_IN_GRIMOIRE: así nunca se acepta uno que el servidor no sabe resolver.
 * Hoy: P0 (Rayo, Escudo) y Meteoro; P1 y P2 llegan en los siguientes commits.
 */
export const IMPLEMENTED_SPELLS: ReadonlySet<SpellId> = new Set<SpellId>(["lightning", "shield"]);
export const IMPLEMENTED_ULTIMATES: ReadonlySet<UltimateId> = new Set<UltimateId>(["meteor"]);

/**
 * Efecto con duración tal como vive en el servidor. Hacia los clientes solo viaja `{ type, until }`
 * (contrato ActiveEffect); el resto es contabilidad interna de los daños por segundo.
 */
export interface RuntimeEffect extends ActiveEffect {
  /** Próximo golpe por segundo. Los golpes caen a +1 s, +2 s… hasta `until` inclusive. */
  nextTickAt: number;
  damagePerSecond: number;
  manaDrainPerSecond: number;
}

export interface PlayerRuntime {
  userId: UserId;
  hp: number;
  /** Se guarda con decimales (+0,4 por tick); a los clientes se envía redondeado hacia abajo. */
  mana: number;
  shieldUntil: number | null;
  effects: RuntimeEffect[];
  cooldownsUntil: Partial<Record<AnySpellId, number>>;
  silencedUntil: number | null;
  used: { "silence-seal": boolean; "purple-void": boolean };
  /** Grimorio validado por el api (nunca viene del cliente). */
  grimoire: ReadonlySet<SpellId>;
  ultimateId: UltimateId;
  /** Último intento de lanzamiento que pasó el rate limit. */
  lastCastAt: number | null;
  /** Fin de la penalización por hechizo fallido. */
  penaltyUntil: number | null;
  /** Desde cuándo sostiene la X del Sello (`combat:seal-charging`); `null` si no la está cargando. */
  sealChargingSince: number | null;
}

export interface CombatState {
  matchId: MatchId;
  status: MatchStatus;
  /** Orden fijo de los dos jugadores (el primero es quien llevaba más tiempo en cola). */
  playerIds: readonly [UserId, UserId];
  players: Record<UserId, PlayerRuntime>;
  /** Fin de la cuenta regresiva; `null` mientras se espera `match:ready`. */
  startsAt: number | null;
  endsAt: number | null;
  /** Hasta dónde se aplicaron ya la regeneración de maná y los efectos por segundo. */
  lastAdvancedAt: number | null;
}

export interface PlayerLoadout {
  userId: UserId;
  spells: readonly SpellId[];
  ultimateId: UltimateId;
}

export type CastResult =
  | { ok: true; outcome: SpellOutcome; damage: number; targetId: UserId }
  | { ok: false; code: RejectionCode };

/** Resultado de seal-charging / seal-cancel: `null` = aceptado. */
export type SealResult = { ok: true } | { ok: false; code: RejectionCode };

export interface MatchResult {
  winnerId: UserId | null;
  reason: EndReason;
}

const reject = (code: RejectionCode) => ({ ok: false, code }) as const;

export function createCombatState(
  matchId: MatchId,
  loadouts: readonly [PlayerLoadout, PlayerLoadout],
  rules: MatchRules = MATCH_RULES,
): CombatState {
  const players: Record<UserId, PlayerRuntime> = {};
  for (const loadout of loadouts) {
    players[loadout.userId] = {
      userId: loadout.userId,
      hp: rules.maxHp,
      mana: rules.startingMana,
      shieldUntil: null,
      effects: [],
      cooldownsUntil: {},
      silencedUntil: null,
      used: { "silence-seal": false, "purple-void": false },
      grimoire: new Set(loadout.spells.filter((id) => IMPLEMENTED_SPELLS.has(id))),
      ultimateId: loadout.ultimateId,
      lastCastAt: null,
      penaltyUntil: null,
      sealChargingSince: null,
    };
  }
  return {
    matchId,
    status: "waiting",
    playerIds: [loadouts[0].userId, loadouts[1].userId],
    players,
    startsAt: null,
    endsAt: null,
    lastAdvancedAt: null,
  };
}

/** Ambos jugadores listos: empieza la cuenta regresiva 3-2-1. El reloj de 90 s arranca al terminarla. */
export function startCountdown(state: CombatState, now: number, rules: MatchRules = MATCH_RULES): void {
  if (state.status !== "waiting") return;
  state.status = "countdown";
  state.startsAt = now + rules.countdownMs;
  state.endsAt = state.startsAt + rules.durationMs;
}

function isSilenced(player: PlayerRuntime, at: number): boolean {
  return player.silencedUntil !== null && at < player.silencedUntil;
}

function hasActiveShield(player: PlayerRuntime, now: number): boolean {
  return player.shieldUntil !== null && now < player.shieldUntil;
}

function hasEffect(player: PlayerRuntime, type: EffectType, now: number): boolean {
  return player.effects.some((effect) => effect.type === type && effect.until > now);
}

/**
 * Avanza el estado hasta `now`: pasa de countdown a active, regenera maná, aplica los golpes por
 * segundo (quemadura, veneno, tormenta) y vence escudos, silencios y efectos.
 * Se llama en cada tick y también antes de validar un hechizo, para que maná y vida estén al día
 * aunque el hechizo llegue entre dos ticks.
 */
export function advance(state: CombatState, now: number, rules: MatchRules = MATCH_RULES): void {
  if (state.status === "countdown" && state.startsAt !== null && now >= state.startsAt) {
    state.status = "active";
    state.lastAdvancedAt = state.startsAt;
  }
  if (state.status !== "active" || state.lastAdvancedAt === null) return;

  // Nada corre más allá del final de la partida aunque el tick llegue tarde.
  const until = Math.min(now, state.endsAt ?? now);
  const from = state.lastAdvancedAt;
  if (until <= from) return;
  state.lastAdvancedAt = until;

  for (const player of Object.values(state.players)) {
    // Sellado regenera más rápido (8/s en vez de 4/s). Se toma el ritmo del inicio del tramo:
    // el error máximo es un tick de 100 ms al terminar el silencio.
    const regenPerSecond = isSilenced(player, from)
      ? SPELLS["silence-seal"].effect.silence.silencedManaRegenPerSecond
      : rules.manaRegenPerSecond;
    player.mana = Math.min(rules.maxMana, player.mana + (regenPerSecond * (until - from)) / 1000);

    // Golpes por segundo en orden de llegada del efecto. Fuego y veneno se acumulan porque son
    // efectos distintos de la lista.
    for (const effect of player.effects) {
      while (effect.nextTickAt <= until && effect.nextTickAt <= effect.until) {
        player.hp = Math.max(0, player.hp - effect.damagePerSecond);
        // El veneno sigue dañando con el maná en 0; el maná nunca baja de 0.
        player.mana = Math.max(0, player.mana - effect.manaDrainPerSecond);
        effect.nextTickAt += 1_000;
      }
    }

    player.effects = player.effects.filter((effect) => effect.until > until);
    if (player.shieldUntil !== null && now >= player.shieldUntil) player.shieldUntil = null;
    if (player.silencedUntil !== null && until >= player.silencedUntil) player.silencedUntil = null;
  }
}

export function getOpponentId(state: CombatState, userId: UserId): UserId {
  const [a, b] = state.playerIds;
  return userId === a ? b : a;
}

/** Un efecto nuevo del mismo tipo reemplaza al anterior (renueva la duración, no se duplica). */
function addEffect(
  target: PlayerRuntime,
  type: EffectType,
  now: number,
  durationMs: number,
  damagePerSecond = 0,
  manaDrainPerSecond = 0,
): void {
  target.effects = target.effects.filter((effect) => effect.type !== type);
  target.effects.push({
    type,
    until: now + durationMs,
    nextTickAt: now + 1_000,
    damagePerSecond,
    manaDrainPerSecond,
  });
}

/**
 * Ataque contra el rival según la columna `shieldInteraction` de game-rules:
 * - absorbed: el escudo lo absorbe por completo, desaparece y no se aplica ningún efecto.
 * - halved: daño a la mitad (hacia abajo) y el escudo desaparece.
 * - unblockable: ignora el escudo, que sigue ahí.
 */
function resolveAttack(
  def: SpellDefinition | UltimateDefinition,
  target: PlayerRuntime,
  now: number,
): { outcome: SpellOutcome; damage: number } {
  const shielded = hasActiveShield(target, now);
  if (shielded && def.shieldInteraction === "absorbed") {
    target.shieldUntil = null;
    return { outcome: "blocked", damage: 0 };
  }

  let damage = def.effect.damage ?? 0;
  let outcome: SpellOutcome = "hit";
  if (shielded && def.shieldInteraction === "halved") {
    damage = halveDamage(damage);
    target.shieldUntil = null;
    outcome = "reduced";
  }
  target.hp = Math.max(0, target.hp - damage);

  const { burn, poison, freeze, silence, storm } = def.effect;
  if (burn) addEffect(target, "burn", now, burn.durationMs, burn.damagePerSecond);
  if (poison) addEffect(target, "poison", now, poison.durationMs, poison.damagePerSecond, poison.manaDrainPerSecond);
  if (freeze) addEffect(target, "freeze", now, freeze.durationMs);
  if (storm) addEffect(target, "storm", now, storm.durationMs, storm.damagePerSecond);
  if (silence) {
    target.silencedUntil = now + silence.durationMs;
    // Sellado no puede terminar de cargar su propio Sello.
    target.sealChargingSince = null;
  }
  return { outcome, damage };
}

/** Curación, Renacer: sobre el propio lanzador. */
function resolveSelf(def: SpellDefinition | UltimateDefinition, caster: PlayerRuntime, rules: MatchRules): void {
  if (def.effect.heal) caster.hp = Math.min(rules.maxHp, caster.hp + def.effect.heal);
  // Renacer quita quemadura, veneno y los demás efectos negativos. Curación no lleva `cleanse`.
  if (def.effect.cleanse) caster.effects = [];
}

/** Validaciones comunes a hechizos y definitivos. */
function checkCommon(state: CombatState, caster: PlayerRuntime | undefined, now: number, rules: MatchRules) {
  if (state.status !== "active" || !caster) return reject("MATCH_NOT_ACTIVE");
  const tooSoon = caster.lastCastAt !== null && now - caster.lastCastAt < rules.minCastIntervalMs;
  const penalized = caster.penaltyUntil !== null && now < caster.penaltyUntil;
  if (tooSoon || penalized) return reject("RATE_LIMIT");
  return null;
}

/**
 * Valida y resuelve un hechizo normal. El orden de las validaciones importa:
 * primero lo que no cuesta nada (partida, grimorio, rate limit), luego la confianza
 * (un gesto fallido penaliza aunque no haya maná) y al final cooldown, requisitos y maná.
 * Ningún rechazo gasta maná.
 */
export function castSpell(
  state: CombatState,
  casterId: UserId,
  spellId: SpellId,
  confidence: number,
  now: number,
  rules: MatchRules = MATCH_RULES,
): CastResult {
  advance(state, now, rules);
  const caster = state.players[casterId];
  if (state.status !== "active" || !caster) return reject("MATCH_NOT_ACTIVE");
  if (!caster.grimoire.has(spellId)) return reject("NOT_IN_GRIMOIRE");
  const common = checkCommon(state, caster, now, rules);
  if (common) return common;
  caster.lastCastAt = now;

  if (isSilenced(caster, now)) return reject("SILENCED");
  if (confidence < rules.minConfidence) {
    caster.penaltyUntil = now + rules.failedCastPenaltyMs;
    return reject("LOW_CONFIDENCE");
  }

  const def: SpellDefinition = SPELLS[spellId];
  const cooldownUntil = caster.cooldownsUntil[spellId];
  if (cooldownUntil !== undefined && now < cooldownUntil) return reject("COOLDOWN");

  const targetId = getOpponentId(state, casterId);
  const target = state.players[targetId]!;

  if (spellId === "silence-seal") {
    if (caster.used["silence-seal"]) return reject("ALREADY_USED");
    // Regla del Sello (sección 7): la X debe llevar ≥ 0,6 s cargada y sin seal-cancel después.
    if (caster.sealChargingSince === null || now - caster.sealChargingSince < rules.sealMinChargeMs) {
      return reject("SEAL_NOT_CHARGED");
    }
    // Sellar a un rival ya sellado se rechaza sin gastar el único uso.
    if (isSilenced(target, now)) return reject("REQUIREMENT_NOT_MET");
  }

  if (caster.mana < def.manaCost) return reject("NO_MANA");

  // A partir de aquí el hechizo se acepta: se cobra y entra en cooldown.
  caster.mana -= def.manaCost;
  if (def.cooldownMs !== null) {
    // Congelado: los cooldowns que empiezan mientras dura el efecto duran el doble.
    const multiplier = hasEffect(caster, "freeze", now) ? SPELLS.freeze.effect.freeze.cooldownMultiplier : 1;
    caster.cooldownsUntil[spellId] = now + def.cooldownMs * multiplier;
  }
  if (spellId === "silence-seal") {
    // Se gasta aunque el escudo lo absorba (sección 6: "el escudo lo absorbe… sin sello").
    caster.used["silence-seal"] = true;
    caster.sealChargingSince = null;
  }

  if (def.shieldInteraction === null) {
    if (spellId === "shield") {
      // Relanzar el escudo con uno activo solo renueva la duración.
      caster.shieldUntil = now + SPELLS.shield.effect.shieldDurationMs;
    } else {
      resolveSelf(def, caster, rules);
    }
    return { ok: true, outcome: "self", damage: 0, targetId: casterId };
  }

  return { ok: true, ...resolveAttack(def, target, now), targetId };
}

/**
 * Definitivos: maná lleno y la palabra gritada (`transcript`) validada aquí otra vez,
 * porque la Arena no decide nada (sección 6, Definitivos).
 */
export function castUltimate(
  state: CombatState,
  casterId: UserId,
  ultimateId: UltimateId,
  transcript: string,
  now: number,
  rules: MatchRules = MATCH_RULES,
): CastResult {
  advance(state, now, rules);
  const caster = state.players[casterId];
  if (state.status !== "active" || !caster) return reject("MATCH_NOT_ACTIVE");
  // Se compara con el definitivo equipado según el api, nunca con lo que diga el cliente.
  if (caster.ultimateId !== ultimateId || !IMPLEMENTED_ULTIMATES.has(ultimateId)) return reject("NOT_IN_GRIMOIRE");
  const common = checkCommon(state, caster, now, rules);
  if (common) return common;
  caster.lastCastAt = now;

  if (isSilenced(caster, now)) return reject("SILENCED");
  // Palabra equivocada = el reconocimiento falló. Sin penalización: no fue un gesto mal dibujado.
  if (!transcriptMatchesUltimate(ultimateId, transcript)) return reject("LOW_CONFIDENCE");

  const def: UltimateDefinition = ULTIMATES[ultimateId];
  if (ultimateId === "purple-void" && caster.used["purple-void"]) return reject("ALREADY_USED");
  // Vacío púrpura con más de 30 de vida: rechazado sin gastar maná. Curarse por encima vuelve a bloquearlo.
  if (def.maxCasterHp !== null && caster.hp > def.maxCasterHp) return reject("REQUIREMENT_NOT_MET");
  if (caster.mana < def.manaCost) return reject("NO_MANA");

  caster.mana -= def.manaCost;
  if (ultimateId === "purple-void") caster.used["purple-void"] = true;

  if (def.shieldInteraction === null) {
    resolveSelf(def, caster, rules);
    return { ok: true, outcome: "self", damage: 0, targetId: casterId };
  }
  const targetId = getOpponentId(state, casterId);
  return { ok: true, ...resolveAttack(def, state.players[targetId]!, now), targetId };
}

/** La X del Sello se formó: empieza a contar el tiempo de carga (≥ 0,6 s antes de lanzar). */
export function sealCharging(
  state: CombatState,
  casterId: UserId,
  now: number,
  rules: MatchRules = MATCH_RULES,
): SealResult {
  advance(state, now, rules);
  const caster = state.players[casterId];
  if (state.status !== "active" || !caster) return reject("MATCH_NOT_ACTIVE");
  if (!caster.grimoire.has("silence-seal")) return reject("NOT_IN_GRIMOIRE");
  if (caster.used["silence-seal"]) return reject("ALREADY_USED");
  if (isSilenced(caster, now)) return reject("SILENCED");
  // Un segundo charging mientras ya carga no reinicia la cuenta.
  caster.sealChargingSince ??= now;
  return { ok: true };
}

/** La X se deshizo antes de tiempo: se anula la carga y no se gasta nada. */
export function sealCancel(state: CombatState, casterId: UserId): SealResult {
  const caster = state.players[casterId];
  if (state.status !== "active" || !caster) return reject("MATCH_NOT_ACTIVE");
  caster.sealChargingSince = null;
  return { ok: true };
}

/** KO en cuanto una vida llega a 0 (también por efectos); al acabar el tiempo gana quien tenga más vida. */
export function checkEnd(state: CombatState, now: number): MatchResult | null {
  if (state.status !== "active") return null;
  const [a, b] = state.playerIds;
  const hpA = state.players[a]!.hp;
  const hpB = state.players[b]!.hp;
  if (hpA <= 0 || hpB <= 0) {
    // Dos efectos por segundo pueden dejar a ambos en 0 en el mismo tick: empate.
    if (hpA <= 0 && hpB <= 0) return { winnerId: null, reason: "DRAW" };
    return { winnerId: hpA <= 0 ? b : a, reason: "KO" };
  }
  if (state.endsAt !== null && now >= state.endsAt) {
    if (hpA === hpB) return { winnerId: null, reason: "DRAW" };
    return { winnerId: hpA > hpB ? a : b, reason: "TIMEOUT" };
  }
  return null;
}

/** Quien abandona pierde; el ganador es el que se quedó. */
export function abandonResult(state: CombatState, abandonerId: UserId): MatchResult {
  return { winnerId: getOpponentId(state, abandonerId), reason: "ABANDON" };
}

export function finish(state: CombatState): void {
  state.status = "ended";
}

/** Estado completo para `match:state`, con los mismos campos que el ejemplo de CLAUDE.md. */
export function toMatchState(state: CombatState, now: number): MatchState {
  const players: Record<UserId, PlayerState> = {};
  for (const player of Object.values(state.players)) {
    const cooldownsUntil: Partial<Record<AnySpellId, number>> = {};
    for (const [id, until] of Object.entries(player.cooldownsUntil)) {
      // Solo aparecen los hechizos que siguen en cooldown (contrato de PlayerState).
      if (until !== undefined && until > now) cooldownsUntil[id as AnySpellId] = until;
    }
    players[player.userId] = {
      hp: player.hp,
      mana: Math.floor(player.mana),
      shieldUntil: hasActiveShield(player, now) ? player.shieldUntil : null,
      // Solo { type, until }: los campos internos de los golpes por segundo no salen del servidor.
      effects: player.effects.filter((e) => e.until > now).map(({ type, until }) => ({ type, until })),
      cooldownsUntil,
      silencedUntil: isSilenced(player, now) ? player.silencedUntil : null,
      used: { ...player.used },
    };
  }
  return {
    matchId: state.matchId,
    status: state.status,
    serverNow: now,
    // Antes de la cuenta regresiva no hay hora de fin; 0 igual que el mock de la Arena.
    endsAt: state.endsAt ?? 0,
    players,
  };
}
