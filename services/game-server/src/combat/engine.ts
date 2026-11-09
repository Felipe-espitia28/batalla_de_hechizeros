/**
 * Motor de combate: reglas del servidor autoritativo sin red, sin reloj y sin Redis.
 *
 * Todas las funciones reciben el estado y el instante `now` explícitos y lo modifican en el sitio.
 * No son "puras" en sentido estricto (mutan), pero son deterministas: mismo estado + mismo `now`
 * = mismo resultado. Eso permite probar cada regla con tests unitarios avanzando el tiempo a mano,
 * y la capa de sockets solo traduce eventos a llamadas de este módulo.
 */
import type {
  ActiveEffect,
  AnySpellId,
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
import { MATCH_RULES, SPELLS, type MatchRules } from "@duelo/game-rules";

/**
 * Hechizos con efecto implementado (P0). Un hechizo del grimorio que no esté aquí
 * se descarta al cargar el loadout y responde NOT_IN_GRIMOIRE: así nunca se acepta
 * un hechizo cuyo efecto el servidor aún no sabe resolver.
 */
export const IMPLEMENTED_SPELLS: ReadonlySet<SpellId> = new Set<SpellId>(["lightning", "shield"]);
/** Definitivos implementados. Meteoro es P1: llega en el siguiente sprint. */
export const IMPLEMENTED_ULTIMATES: ReadonlySet<UltimateId> = new Set<UltimateId>();

export interface PlayerRuntime {
  userId: UserId;
  hp: number;
  /** Se guarda con decimales (+0,4 por tick); a los clientes se envía redondeado hacia abajo. */
  mana: number;
  shieldUntil: number | null;
  effects: ActiveEffect[];
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
  /** Hasta dónde se aplicó ya la regeneración de maná. */
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

export interface MatchResult {
  winnerId: UserId | null;
  reason: EndReason;
}

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

/**
 * Avanza el estado hasta `now`: pasa de countdown a active, regenera maná y vence escudos.
 * Se llama en cada tick y también antes de validar un hechizo, para que el maná
 * esté al día aunque el hechizo llegue entre dos ticks.
 */
export function advance(state: CombatState, now: number, rules: MatchRules = MATCH_RULES): void {
  if (state.status === "countdown" && state.startsAt !== null && now >= state.startsAt) {
    state.status = "active";
    state.lastAdvancedAt = state.startsAt;
  }
  if (state.status !== "active" || state.lastAdvancedAt === null) return;

  // No se regenera más allá del final de la partida aunque el tick llegue tarde.
  const until = Math.min(now, state.endsAt ?? now);
  const elapsedMs = until - state.lastAdvancedAt;
  if (elapsedMs <= 0) return;
  state.lastAdvancedAt = until;

  for (const player of Object.values(state.players)) {
    player.mana = Math.min(rules.maxMana, player.mana + (rules.manaRegenPerSecond * elapsedMs) / 1000);
    if (player.shieldUntil !== null && now >= player.shieldUntil) player.shieldUntil = null;
    player.effects = player.effects.filter((effect) => effect.until > now);
  }
}

export function getOpponentId(state: CombatState, userId: UserId): UserId {
  const [a, b] = state.playerIds;
  return userId === a ? b : a;
}

function hasActiveShield(player: PlayerRuntime, now: number): boolean {
  return player.shieldUntil !== null && now < player.shieldUntil;
}

/**
 * Valida y resuelve un hechizo normal. El orden de las validaciones importa:
 * primero lo que no cuesta nada (partida, grimorio, rate limit), luego la confianza
 * (un gesto fallido penaliza aunque no haya maná) y al final cooldown y maná.
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
  if (state.status !== "active" || !caster) return { ok: false, code: "MATCH_NOT_ACTIVE" };
  if (!caster.grimoire.has(spellId)) return { ok: false, code: "NOT_IN_GRIMOIRE" };

  const tooSoon = caster.lastCastAt !== null && now - caster.lastCastAt < rules.minCastIntervalMs;
  const penalized = caster.penaltyUntil !== null && now < caster.penaltyUntil;
  if (tooSoon || penalized) return { ok: false, code: "RATE_LIMIT" };
  caster.lastCastAt = now;

  if (caster.silencedUntil !== null && now < caster.silencedUntil) return { ok: false, code: "SILENCED" };
  if (confidence < rules.minConfidence) {
    caster.penaltyUntil = now + rules.failedCastPenaltyMs;
    return { ok: false, code: "LOW_CONFIDENCE" };
  }

  const def = SPELLS[spellId];
  const cooldownUntil = caster.cooldownsUntil[spellId];
  if (cooldownUntil !== undefined && now < cooldownUntil) return { ok: false, code: "COOLDOWN" };
  if (caster.mana < def.manaCost) return { ok: false, code: "NO_MANA" };

  caster.mana -= def.manaCost;
  if (def.cooldownMs !== null) caster.cooldownsUntil[spellId] = now + def.cooldownMs;

  const targetId = getOpponentId(state, casterId);
  const target = state.players[targetId]!;

  switch (spellId) {
    case "shield": {
      // Relanzar el escudo con uno activo solo renueva la duración.
      caster.shieldUntil = now + SPELLS.shield.effect.shieldDurationMs;
      return { ok: true, outcome: "self", damage: 0, targetId: casterId };
    }
    case "lightning": {
      if (hasActiveShield(target, now)) {
        // "absorbed": el escudo se consume y el ataque no hace nada.
        target.shieldUntil = null;
        return { ok: true, outcome: "blocked", damage: 0, targetId };
      }
      const damage = SPELLS.lightning.effect.damage;
      target.hp = Math.max(0, target.hp - damage);
      return { ok: true, outcome: "hit", damage, targetId };
    }
    default:
      // Inalcanzable mientras IMPLEMENTED_SPELLS filtre el grimorio; se devuelve el maná por si acaso.
      caster.mana += def.manaCost;
      delete caster.cooldownsUntil[spellId];
      return { ok: false, code: "NOT_IN_GRIMOIRE" };
  }
}

/**
 * Definitivos (P1/P2). Mientras IMPLEMENTED_ULTIMATES esté vacío todos se rechazan con
 * NOT_IN_GRIMOIRE; al implementar Meteoro aquí irán maná lleno, palabra (transcriptMatchesUltimate),
 * requisito de vida y usos por partida.
 */
export function castUltimate(
  state: CombatState,
  casterId: UserId,
  ultimateId: UltimateId,
  now: number,
  rules: MatchRules = MATCH_RULES,
): CastResult {
  advance(state, now, rules);
  const caster = state.players[casterId];
  if (state.status !== "active" || !caster) return { ok: false, code: "MATCH_NOT_ACTIVE" };
  // Se compara con el definitivo equipado según el api, nunca con lo que diga el cliente.
  if (caster.ultimateId !== ultimateId || !IMPLEMENTED_ULTIMATES.has(ultimateId)) {
    return { ok: false, code: "NOT_IN_GRIMOIRE" };
  }
  return { ok: false, code: "NOT_IN_GRIMOIRE" };
}

/** KO en cuanto una vida llega a 0; al acabar el tiempo gana quien tenga más vida. */
export function checkEnd(state: CombatState, now: number): MatchResult | null {
  if (state.status !== "active") return null;
  const [a, b] = state.playerIds;
  const hpA = state.players[a]!.hp;
  const hpB = state.players[b]!.hp;
  if (hpA <= 0 || hpB <= 0) {
    // Un solo hechizo no puede dejar a ambos en 0, pero si pasara (efectos P1) sería empate.
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
      effects: player.effects.map((effect) => ({ ...effect })),
      cooldownsUntil,
      silencedUntil: player.silencedUntil !== null && player.silencedUntil > now ? player.silencedUntil : null,
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
