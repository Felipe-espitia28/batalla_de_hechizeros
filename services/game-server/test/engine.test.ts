import { MATCH_RULES } from "@duelo/game-rules";
import { describe, expect, it } from "vitest";
import {
  abandonResult,
  advance,
  castSpell,
  castUltimate,
  checkEnd,
  createCombatState,
  startCountdown,
  toMatchState,
  type CombatState,
} from "../src/combat/engine.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const T0 = 1_000_000;
/** Instante en que la partida pasa a active (tras la cuenta regresiva). */
const START = T0 + MATCH_RULES.countdownMs;

function activeMatch(): CombatState {
  const state = createCombatState("m_test", [
    { userId: A, spells: ["lightning", "shield"], ultimateId: "meteor" },
    { userId: B, spells: ["lightning", "shield"], ultimateId: "meteor" },
  ]);
  startCountdown(state, T0);
  advance(state, START);
  return state;
}

describe("inicio y maná", () => {
  it("arranca con 100 de vida, 30 de maná y en espera", () => {
    const state = createCombatState("m", [
      { userId: A, spells: ["lightning", "shield"], ultimateId: "meteor" },
      { userId: B, spells: ["lightning", "shield"], ultimateId: "meteor" },
    ]);
    expect(state.status).toBe("waiting");
    expect(state.players[A]).toMatchObject({ hp: 100, mana: 30 });
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
    expect(state.players[A]!.mana).toBeCloseTo(40);
    advance(state, START + 60_000);
    expect(state.players[A]!.mana).toBe(100);
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
    const result = castSpell(state, A, "lightning", 0.91, START);
    expect(result).toEqual({ ok: true, outcome: "hit", damage: 10, targetId: B });
    expect(state.players[B]!.hp).toBe(90);
    expect(state.players[A]!.mana).toBe(20);
    expect(toMatchState(state, START).players[A]!.cooldownsUntil).toEqual({ lightning: START + 1_500 });

    expect(castSpell(state, A, "lightning", 0.9, START + 1_000)).toEqual({ ok: false, code: "COOLDOWN" });
    expect(castSpell(state, A, "lightning", 0.9, START + 1_500)).toMatchObject({ ok: true });
  });

  it("rechaza sin maná y no lo gasta", () => {
    const state = activeMatch();
    state.players[A]!.mana = 9;
    expect(castSpell(state, A, "lightning", 0.9, START)).toEqual({ ok: false, code: "NO_MANA" });
    expect(state.players[A]!.mana).toBe(9);
    expect(state.players[B]!.hp).toBe(100);
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
    expect(state.players[A]!.mana).toBe(30);
    expect(castSpell(state, A, "lightning", 0.95, START + 400)).toEqual({ ok: false, code: "RATE_LIMIT" });
    expect(castSpell(state, A, "lightning", 0.95, START + 500)).toMatchObject({ ok: true });
  });

  it("rechaza hechizos fuera del grimorio o aún no implementados", () => {
    const state = createCombatState("m", [
      { userId: A, spells: ["lightning", "shield", "fireball"], ultimateId: "meteor" },
      { userId: B, spells: ["lightning", "shield"], ultimateId: "meteor" },
    ]);
    startCountdown(state, T0);
    expect(castSpell(state, A, "fireball", 0.9, START)).toEqual({ ok: false, code: "NOT_IN_GRIMOIRE" });
    expect(castSpell(state, B, "slash", 0.9, START)).toEqual({ ok: false, code: "NOT_IN_GRIMOIRE" });
    expect(castUltimate(state, A, "meteor", START)).toEqual({ ok: false, code: "NOT_IN_GRIMOIRE" });
  });

  it("rechaza jugadores ajenos a la partida", () => {
    const state = activeMatch();
    expect(castSpell(state, "intruso", "lightning", 0.9, START)).toEqual({ ok: false, code: "MATCH_NOT_ACTIVE" });
  });
});

describe("Escudo", () => {
  it("absorbe por completo el siguiente ataque y desaparece", () => {
    const state = activeMatch();
    expect(castSpell(state, B, "shield", 0.9, START)).toEqual({ ok: true, outcome: "self", damage: 0, targetId: B });
    expect(state.players[B]!.mana).toBe(10);
    expect(castSpell(state, A, "lightning", 0.9, START + 1_000)).toEqual({
      ok: true,
      outcome: "blocked",
      damage: 0,
      targetId: B,
    });
    expect(state.players[B]!.hp).toBe(100);
    expect(state.players[B]!.shieldUntil).toBeNull();
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
    state.players[B]!.mana = 100;
    expect(castSpell(state, B, "shield", 0.9, START + 5_999)).toEqual({ ok: false, code: "COOLDOWN" });
  });
});

describe("fin de partida", () => {
  it("KO cuando la vida del rival llega a 0", () => {
    const state = activeMatch();
    state.players[B]!.hp = 10;
    castSpell(state, A, "lightning", 0.9, START);
    expect(state.players[B]!.hp).toBe(0);
    expect(checkEnd(state, START)).toEqual({ winnerId: A, reason: "KO" });
  });

  it("al acabar el tiempo gana quien tenga más vida", () => {
    const state = activeMatch();
    castSpell(state, A, "lightning", 0.9, START);
    expect(checkEnd(state, START + 89_999)).toBeNull();
    expect(checkEnd(state, START + 90_000)).toEqual({ winnerId: A, reason: "TIMEOUT" });
  });

  it("empate con la misma vida", () => {
    const state = activeMatch();
    expect(checkEnd(state, START + 90_000)).toEqual({ winnerId: null, reason: "DRAW" });
  });

  it("no regenera maná más allá del final", () => {
    const state = activeMatch();
    state.players[A]!.mana = 0;
    advance(state, START + 200_000);
    expect(state.players[A]!.mana).toBe(100);
    state.players[A]!.mana = 0;
    advance(state, START + 300_000);
    expect(state.players[A]!.mana).toBe(0);
  });

  it("abandono: gana quien se queda", () => {
    expect(abandonResult(activeMatch(), B)).toEqual({ winnerId: A, reason: "ABANDON" });
  });
});
