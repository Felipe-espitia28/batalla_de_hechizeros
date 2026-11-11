/**
 * Reglas del motor (sección 6 de CLAUDE.md), avanzando `now` a mano.
 * Los números esperados se leen de @duelo/game-rules cuando el test no es sobre el número en sí,
 * para que un cambio de balance no rompa tests que prueban otra cosa.
 */
import { SPELL_IDS, type SpellId, type UltimateId } from "@duelo/contracts";
import { MATCH_RULES, SPELLS, ULTIMATES, type MatchRules } from "@duelo/game-rules";
import { describe, expect, it } from "vitest";
import {
  abandonResult,
  advance,
  castSpell,
  castUltimate,
  checkEnd,
  createCombatState,
  sealCancel,
  sealCharging,
  startCountdown,
  toMatchState,
  type CombatState,
} from "../src/combat/engine.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const T0 = 1_000_000;
/** Instante en que la partida pasa a active (tras la cuenta regresiva). */
const START = T0 + MATCH_RULES.countdownMs;
/** Separación entre lanzamientos del mismo jugador para no chocar con el rate limit. */
const GAP = MATCH_RULES.minCastIntervalMs;

interface MatchOptions {
  spells?: readonly SpellId[];
  ultimateA?: UltimateId;
  ultimateB?: UltimateId;
  rules?: MatchRules;
}

function activeMatch({ spells = SPELL_IDS, ultimateA = "meteor", ultimateB = "meteor", rules = MATCH_RULES }: MatchOptions = {}): CombatState {
  const state = createCombatState(
    "m_test",
    [
      { userId: A, spells, ultimateId: ultimateA },
      { userId: B, spells, ultimateId: ultimateB },
    ],
    rules,
  );
  startCountdown(state, T0, rules);
  advance(state, START, rules);
  return state;
}

const player = (state: CombatState, id: string) => state.players[id]!;
const effectsOf = (state: CombatState, id: string, now: number) => toMatchState(state, now).players[id]!.effects;
/** Carga la X y lanza el Sello `chargeMs` después. */
function castSeal(state: CombatState, casterId: string, at: number, chargeMs: number = MATCH_RULES.sealMinChargeMs) {
  sealCharging(state, casterId, at);
  return castSpell(state, casterId, "silence-seal", 1, at + chargeMs);
}

// ---------------------------------------------------------------------------
// P0
// ---------------------------------------------------------------------------

describe("inicio y maná", () => {
  it("arranca con 100 de vida, 30 de maná y en espera", () => {
    const state = createCombatState("m", [
      { userId: A, spells: ["lightning", "shield"], ultimateId: "meteor" },
      { userId: B, spells: ["lightning", "shield"], ultimateId: "meteor" },
    ]);
    expect(state.status).toBe("waiting");
    expect(player(state, A)).toMatchObject({ hp: 100, mana: 30 });
  });

  it("no deja lanzar durante la cuenta regresiva", () => {
    const state = createCombatState("m", [
      { userId: A, spells: ["lightning"], ultimateId: "meteor" },
      { userId: B, spells: ["lightning"], ultimateId: "meteor" },
    ]);
    startCountdown(state, T0);
    expect(state.status).toBe("countdown");
    expect(state.endsAt).toBe(START + 90_000);
    expect(castSpell(state, A, "lightning", 0.9, T0 + 1_000)).toEqual({ ok: false, code: "MATCH_NOT_ACTIVE" });
  });

  it("regenera 4 de maná por segundo solo desde el inicio y con tope 100", () => {
    const state = activeMatch();
    advance(state, START + 2_500);
    expect(player(state, A).mana).toBeCloseTo(40);
    advance(state, START + 60_000);
    expect(player(state, A).mana).toBe(100);
  });

  it("envía el maná redondeado hacia abajo", () => {
    const state = activeMatch();
    advance(state, START + 350);
    expect(toMatchState(state, START + 350).players[A]!.mana).toBe(31);
  });
});

describe("Rayo", () => {
  it("hace 10 de daño, gasta 10 de maná y entra en cooldown de 1,5 s", () => {
    const state = activeMatch();
    expect(castSpell(state, A, "lightning", 0.91, START)).toEqual({ ok: true, outcome: "hit", damage: 10, targetId: B });
    expect(player(state, B).hp).toBe(90);
    expect(player(state, A).mana).toBe(20);
    expect(toMatchState(state, START).players[A]!.cooldownsUntil).toEqual({ lightning: START + 1_500 });
    expect(castSpell(state, A, "lightning", 0.9, START + 1_000)).toEqual({ ok: false, code: "COOLDOWN" });
    expect(castSpell(state, A, "lightning", 0.9, START + 1_500)).toMatchObject({ ok: true });
  });

  it("rechaza sin maná y no lo gasta", () => {
    const state = activeMatch();
    player(state, A).mana = 9;
    expect(castSpell(state, A, "lightning", 0.9, START)).toEqual({ ok: false, code: "NO_MANA" });
    expect(player(state, A).mana).toBe(9);
    expect(player(state, B).hp).toBe(100);
  });
});

describe("validaciones anti-trampas", () => {
  it("rechaza dos lanzamientos a menos de 300 ms", () => {
    const state = activeMatch();
    expect(castSpell(state, A, "shield", 0.9, START)).toMatchObject({ ok: true });
    expect(castSpell(state, A, "lightning", 0.9, START + 299)).toEqual({ ok: false, code: "RATE_LIMIT" });
    expect(castSpell(state, A, "lightning", 0.9, START + 600)).toMatchObject({ ok: true });
  });

  it("confianza < 0,80: falla, no gasta maná y penaliza 0,5 s", () => {
    const state = activeMatch();
    expect(castSpell(state, A, "lightning", 0.79, START)).toEqual({ ok: false, code: "LOW_CONFIDENCE" });
    expect(player(state, A).mana).toBe(30);
    expect(castSpell(state, A, "lightning", 0.95, START + 400)).toEqual({ ok: false, code: "RATE_LIMIT" });
    expect(castSpell(state, A, "lightning", 0.95, START + 500)).toMatchObject({ ok: true });
  });

  it("rechaza hechizos fuera del grimorio del api", () => {
    const state = activeMatch({ spells: ["lightning", "shield"] });
    expect(castSpell(state, A, "fireball", 0.9, START)).toEqual({ ok: false, code: "NOT_IN_GRIMOIRE" });
    expect(sealCharging(state, A, START)).toEqual({ ok: false, code: "NOT_IN_GRIMOIRE" });
  });

  it("rechaza jugadores ajenos a la partida", () => {
    const state = activeMatch();
    expect(castSpell(state, "intruso", "lightning", 0.9, START)).toEqual({ ok: false, code: "MATCH_NOT_ACTIVE" });
    expect(castUltimate(state, "intruso", "meteor", "meteoro", START)).toEqual({ ok: false, code: "MATCH_NOT_ACTIVE" });
  });
});

describe("Escudo", () => {
  it("absorbe por completo el siguiente ataque y desaparece", () => {
    const state = activeMatch();
    expect(castSpell(state, B, "shield", 0.9, START)).toEqual({ ok: true, outcome: "self", damage: 0, targetId: B });
    expect(player(state, B).mana).toBe(10);
    expect(castSpell(state, A, "lightning", 0.9, START + 1_000)).toEqual({ ok: true, outcome: "blocked", damage: 0, targetId: B });
    expect(player(state, B).hp).toBe(100);
    expect(player(state, B).shieldUntil).toBeNull();
    // El escudo ya se consumió: el siguiente Rayo entra.
    expect(castSpell(state, A, "lightning", 0.9, START + 2_500)).toMatchObject({ outcome: "hit", damage: 10 });
  });

  it("dura 3 s", () => {
    const state = activeMatch();
    castSpell(state, B, "shield", 0.9, START);
    expect(toMatchState(state, START + 2_999).players[B]!.shieldUntil).toBe(START + 3_000);
    expect(castSpell(state, A, "lightning", 0.9, START + 3_000)).toMatchObject({ outcome: "hit" });
  });

  it("tiene cooldown de 6 s", () => {
    const state = activeMatch();
    castSpell(state, B, "shield", 0.9, START);
    player(state, B).mana = 100;
    expect(castSpell(state, B, "shield", 0.9, START + 5_999)).toEqual({ ok: false, code: "COOLDOWN" });
  });
});

describe("fin de partida", () => {
  it("KO cuando la vida del rival llega a 0", () => {
    const state = activeMatch();
    player(state, B).hp = 10;
    castSpell(state, A, "lightning", 0.9, START);
    expect(checkEnd(state, START)).toEqual({ winnerId: A, reason: "KO" });
  });

  it("al acabar el tiempo gana quien tenga más vida", () => {
    const state = activeMatch();
    castSpell(state, A, "lightning", 0.9, START);
    expect(checkEnd(state, START + 89_999)).toBeNull();
    expect(checkEnd(state, START + 90_000)).toEqual({ winnerId: A, reason: "TIMEOUT" });
  });

  it("empate con la misma vida", () => {
    expect(checkEnd(activeMatch(), START + 90_000)).toEqual({ winnerId: null, reason: "DRAW" });
  });

  it("no regenera maná ni aplica efectos más allá del final", () => {
    const state = activeMatch();
    player(state, A).mana = 0;
    advance(state, START + 200_000);
    expect(player(state, A).mana).toBe(100);
    player(state, A).mana = 0;
    advance(state, START + 300_000);
    expect(player(state, A).mana).toBe(0);
  });

  it("abandono: gana quien se queda", () => {
    expect(abandonResult(activeMatch(), B)).toEqual({ winnerId: A, reason: "ABANDON" });
  });
});

// ---------------------------------------------------------------------------
// Meteoro (P1, R4 micrófono)
// ---------------------------------------------------------------------------

describe("Meteoro", () => {
  it("con maná lleno y la palabra correcta hace 35 de daño y gasta los 100", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    expect(castUltimate(state, A, "meteor", "meteoro", START)).toEqual({ ok: true, outcome: "hit", damage: 35, targetId: B });
    expect(player(state, B).hp).toBe(65);
    expect(player(state, A).mana).toBe(0);
  });

  it("normaliza el texto: mayúsculas, tildes y signos", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    expect(castUltimate(state, A, "meteor", "¡METEÓRO!", START)).toMatchObject({ ok: true, damage: 35 });
  });

  it("contra escudo: la mitad (17) y el escudo desaparece", () => {
    const state = activeMatch();
    castSpell(state, B, "shield", 0.9, START);
    player(state, A).mana = 100;
    expect(castUltimate(state, A, "meteor", "meteoro", START + 100)).toEqual({ ok: true, outcome: "reduced", damage: 17, targetId: B });
    expect(player(state, B).hp).toBe(83);
    expect(player(state, B).shieldUntil).toBeNull();
  });

  it("sin maná lleno: NO_MANA y no gasta nada", () => {
    const state = activeMatch();
    player(state, A).mana = 99;
    expect(castUltimate(state, A, "meteor", "meteoro", START)).toEqual({ ok: false, code: "NO_MANA" });
    expect(player(state, A).mana).toBe(99);
  });

  it("palabra equivocada: LOW_CONFIDENCE, sin gastar maná ni penalizar", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    expect(castUltimate(state, A, "meteor", "meteorológico", START)).toEqual({ ok: false, code: "LOW_CONFIDENCE" });
    expect(player(state, A).mana).toBe(100);
    expect(castUltimate(state, A, "meteor", "meteoro", START + GAP)).toMatchObject({ ok: true });
  });

  it("solo el definitivo equipado: otro es NOT_IN_GRIMOIRE", () => {
    const state = activeMatch({ ultimateA: "meteor" });
    player(state, A).mana = 100;
    expect(castUltimate(state, A, "storm", "tormenta", START)).toEqual({ ok: false, code: "NOT_IN_GRIMOIRE" });
  });
});


// ---------------------------------------------------------------------------
// Orden de llegada
// ---------------------------------------------------------------------------

describe("orden de llegada", () => {
  it("dos hechizos casi simultáneos se procesan en el orden en que llegan", () => {
    const state = activeMatch();
    // B lanza el escudo un instante antes del Rayo de A: el Rayo se bloquea.
    castSpell(state, B, "shield", 0.9, START);
    expect(castSpell(state, A, "lightning", 0.9, START)).toMatchObject({ outcome: "blocked" });
  });
});
