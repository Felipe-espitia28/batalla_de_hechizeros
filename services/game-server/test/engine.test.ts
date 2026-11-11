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
// P1
// ---------------------------------------------------------------------------

describe("Corte", () => {
  it("hace 5 de daño, gasta 6 y tiene cooldown de 0,8 s", () => {
    const state = activeMatch();
    expect(castSpell(state, A, "slash", 0.9, START)).toEqual({ ok: true, outcome: "hit", damage: 5, targetId: B });
    expect(player(state, B).hp).toBe(95);
    expect(player(state, A).mana).toBe(24);
    expect(castSpell(state, A, "slash", 0.9, START + 799)).toEqual({ ok: false, code: "COOLDOWN" });
  });
});

describe("Bola de fuego", () => {
  it("hace 15 de daño y deja una quemadura de 2/s durante 3 s (21 en total)", () => {
    const state = activeMatch();
    expect(castSpell(state, A, "fireball", 0.9, START)).toMatchObject({ ok: true, outcome: "hit", damage: 15 });
    expect(player(state, B).hp).toBe(85);
    expect(effectsOf(state, B, START)).toEqual([{ type: "burn", until: START + 3_000 }]);

    advance(state, START + 999);
    expect(player(state, B).hp).toBe(85);
    advance(state, START + 1_000);
    expect(player(state, B).hp).toBe(83);
    advance(state, START + 5_000);
    expect(player(state, B).hp).toBe(79);
    expect(effectsOf(state, B, START + 5_000)).toEqual([]);
  });

  it("gasta 25 de maná y tiene cooldown de 4 s", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    castSpell(state, A, "fireball", 0.9, START);
    expect(player(state, A).mana).toBe(75);
    expect(castSpell(state, A, "fireball", 0.9, START + 3_999)).toEqual({ ok: false, code: "COOLDOWN" });
  });
});

describe("Curación", () => {
  it("cura 15 sin pasar de 100", () => {
    const state = activeMatch();
    player(state, A).hp = 50;
    expect(castSpell(state, A, "heal", 0.9, START)).toEqual({ ok: true, outcome: "self", damage: 0, targetId: A });
    expect(player(state, A).hp).toBe(65);
    player(state, A).hp = 95;
    player(state, A).mana = 100;
    player(state, A).cooldownsUntil = {};
    castSpell(state, A, "heal", 0.9, START + GAP);
    expect(player(state, A).hp).toBe(100);
  });

  it("con quemadura o veneno cura la vida pero el efecto sigue", () => {
    const state = activeMatch();
    player(state, B).mana = 100;
    castSpell(state, B, "fireball", 0.9, START);
    castSpell(state, B, "poison", 0.9, START + GAP);
    player(state, A).mana = 100;
    castSpell(state, A, "heal", 0.9, START + 500);
    expect(player(state, A).hp).toBe(100);
    expect(effectsOf(state, A, START + 500).map((e) => e.type).sort()).toEqual(["burn", "poison"]);
  });
});

describe("Veneno", () => {
  it("quita 2 de vida y 3 de maná por segundo durante 6 s", () => {
    // Sin regeneración para ver solo el drenaje.
    const rules = { ...MATCH_RULES, manaRegenPerSecond: 0 };
    const state = activeMatch({ rules });
    player(state, A).mana = 100;
    castSpell(state, A, "poison", 0.9, START, rules);
    player(state, B).mana = 50;
    advance(state, START + 6_000, rules);
    expect(player(state, B).hp).toBe(88);
    expect(player(state, B).mana).toBe(32);
    advance(state, START + 10_000, rules);
    expect(player(state, B).hp).toBe(88);
  });

  it("con el rival en 0 de maná sigue haciendo daño y el maná no baja de 0", () => {
    const rules = { ...MATCH_RULES, manaRegenPerSecond: 0 };
    const state = activeMatch({ rules });
    castSpell(state, A, "poison", 0.9, START, rules);
    player(state, B).mana = 1;
    advance(state, START + 6_000, rules);
    expect(player(state, B).mana).toBe(0);
    expect(player(state, B).hp).toBe(88);
  });
});

describe("Congelar", () => {
  it("los cooldowns del rival duran el doble durante 5 s", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    castSpell(state, A, "freeze", 0.9, START);
    expect(effectsOf(state, B, START)).toEqual([{ type: "freeze", until: START + 5_000 }]);

    castSpell(state, B, "lightning", 0.9, START + 100);
    expect(player(state, B).cooldownsUntil.lightning).toBe(START + 100 + 2 * SPELLS.lightning.cooldownMs);
    // Pasado el efecto, cooldown normal.
    castSpell(state, B, "slash", 0.9, START + 5_000);
    expect(player(state, B).cooldownsUntil.slash).toBe(START + 5_000 + SPELLS.slash.cooldownMs);
  });

  it("no afecta al que lo lanza", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    castSpell(state, A, "freeze", 0.9, START);
    castSpell(state, A, "lightning", 0.9, START + GAP);
    expect(player(state, A).cooldownsUntil.lightning).toBe(START + GAP + SPELLS.lightning.cooldownMs);
  });
});

describe("efectos combinados y KO por efectos", () => {
  it("Fuego y Veneno se acumulan", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    castSpell(state, A, "fireball", 0.9, START);
    castSpell(state, A, "poison", 0.9, START + GAP);
    // 15 del impacto + 3 golpes de quemadura (2) + 6 golpes de veneno (2).
    advance(state, START + 10_000);
    expect(player(state, B).hp).toBe(100 - 15 - 6 - 12);
  });

  it("un efecto por segundo puede causar KO", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    castSpell(state, A, "fireball", 0.9, START);
    player(state, B).hp = 2;
    advance(state, START + 1_000);
    expect(checkEnd(state, START + 1_000)).toEqual({ winnerId: A, reason: "KO" });
  });

  it("si ambos llegan a 0 en el mismo tick es DRAW", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    player(state, B).mana = 100;
    castSpell(state, A, "fireball", 0.9, START);
    castSpell(state, B, "fireball", 0.9, START);
    player(state, A).hp = 2;
    player(state, B).hp = 2;
    advance(state, START + 1_000);
    expect(checkEnd(state, START + 1_000)).toEqual({ winnerId: null, reason: "DRAW" });
  });

  it("match:state solo expone { type, until } de cada efecto", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    castSpell(state, A, "poison", 0.9, START);
    expect(Object.keys(effectsOf(state, B, START)[0]!).sort()).toEqual(["type", "until"]);
  });
});

// ---------------------------------------------------------------------------
// P2
// ---------------------------------------------------------------------------

describe("Sello de silencio", () => {
  it("con 0,6 s de carga: el rival queda sellado 7 s y se avisa del uso", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    expect(castSeal(state, A, START)).toEqual({ ok: true, outcome: "hit", damage: 0, targetId: B });
    const sealedAt = START + 600;
    expect(player(state, A).mana).toBe(30);
    expect(toMatchState(state, sealedAt).players[B]!.silencedUntil).toBe(sealedAt + 7_000);
    expect(toMatchState(state, sealedAt).players[A]!.used["silence-seal"]).toBe(true);
  });

  it("sin seal-charging previo o con menos de 0,6 s: SEAL_NOT_CHARGED", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    expect(castSpell(state, A, "silence-seal", 1, START)).toEqual({ ok: false, code: "SEAL_NOT_CHARGED" });
    expect(castSeal(state, A, START + GAP, 599)).toEqual({ ok: false, code: "SEAL_NOT_CHARGED" });
    expect(player(state, A).mana).toBe(100);
  });

  it("seal-cancel anula la carga", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    sealCharging(state, A, START);
    sealCancel(state, A);
    expect(castSpell(state, A, "silence-seal", 1, START + 1_000)).toEqual({ ok: false, code: "SEAL_NOT_CHARGED" });
  });

  it("una sola vez por partida", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    castSeal(state, A, START);
    player(state, A).mana = 100;
    expect(sealCharging(state, A, START + 10_000)).toEqual({ ok: false, code: "ALREADY_USED" });
    expect(castSpell(state, A, "silence-seal", 1, START + 10_700)).toEqual({ ok: false, code: "ALREADY_USED" });
  });

  it("sellado no puede lanzar nada, ni definitivos", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    castSeal(state, A, START);
    player(state, B).mana = 100;
    expect(castSpell(state, B, "lightning", 0.9, START + 1_000)).toEqual({ ok: false, code: "SILENCED" });
    expect(castUltimate(state, B, "meteor", "meteoro", START + 2_000)).toEqual({ ok: false, code: "SILENCED" });
    expect(sealCharging(state, B, START + 3_000)).toEqual({ ok: false, code: "SILENCED" });
    // Al terminar el silencio vuelve a lanzar.
    expect(castSpell(state, B, "lightning", 0.9, START + 600 + 7_000)).toMatchObject({ ok: true });
  });

  it("sellado recupera maná a 8/s", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    castSeal(state, A, START);
    player(state, B).mana = 0;
    advance(state, START + 600 + 2_000);
    expect(player(state, B).mana).toBeCloseTo(16);
  });

  it("sellar a un rival ya sellado se rechaza sin gastar el uso ni el maná", () => {
    const state = activeMatch();
    player(state, B).silencedUntil = START + 10_000;
    player(state, A).mana = 100;
    expect(castSeal(state, A, START)).toEqual({ ok: false, code: "REQUIREMENT_NOT_MET" });
    expect(player(state, A).mana).toBe(100);
    expect(player(state, A).used["silence-seal"]).toBe(false);
  });

  it("si el rival lo sella mientras carga, la carga se pierde", () => {
    const state = activeMatch();
    player(state, A).mana = 100;
    player(state, B).mana = 100;
    sealCharging(state, B, START);
    castSeal(state, A, START);
    expect(player(state, B).sealChargingSince).toBeNull();
  });
});

describe("Tormenta", () => {
  it("8 de daño por segundo durante 5 s (40) y gasta el maná lleno", () => {
    const state = activeMatch({ ultimateA: "storm" });
    player(state, A).mana = 100;
    expect(castUltimate(state, A, "storm", "tormenta", START)).toEqual({ ok: true, outcome: "hit", damage: 0, targetId: B });
    expect(effectsOf(state, B, START)).toEqual([{ type: "storm", until: START + 5_000 }]);
    advance(state, START + 10_000);
    expect(player(state, B).hp).toBe(60);
  });
});

describe("Renacer", () => {
  it("+40 de vida sin pasar de 100 y quita quemadura, veneno y efectos negativos", () => {
    const state = activeMatch({ ultimateA: "rebirth" });
    player(state, B).mana = 100;
    castSpell(state, B, "fireball", 0.9, START);
    castSpell(state, B, "poison", 0.9, START + GAP);
    castSpell(state, B, "freeze", 0.9, START + 2 * GAP);
    player(state, A).hp = 30;
    player(state, A).mana = 100;
    // Antes del primer golpe de la quemadura (+1 s), para que la cuenta sea exacta.
    expect(castUltimate(state, A, "rebirth", "renacer", START + 900)).toEqual({ ok: true, outcome: "self", damage: 0, targetId: A });
    expect(player(state, A).hp).toBe(70);
    expect(effectsOf(state, A, START + 900)).toEqual([]);
    // Sin efectos, ya no hay más golpes.
    advance(state, START + 8_000);
    expect(player(state, A).hp).toBe(70);
    player(state, A).hp = 90;
    player(state, A).mana = 100;
    castUltimate(state, A, "rebirth", "renacer", START + 2_000);
    expect(player(state, A).hp).toBe(100);
  });
});

describe("Vacío púrpura", () => {
  it("con vida ≤ 30 hace 50 de daño", () => {
    const state = activeMatch({ ultimateA: "purple-void" });
    player(state, A).hp = 30;
    player(state, A).mana = 100;
    expect(castUltimate(state, A, "purple-void", "¡Vacío!", START)).toEqual({ ok: true, outcome: "hit", damage: 50, targetId: B });
    expect(player(state, B).hp).toBe(50);
    expect(toMatchState(state, START).players[A]!.used["purple-void"]).toBe(true);
  });

  it("acepta también «púrpura»", () => {
    const state = activeMatch({ ultimateA: "purple-void" });
    player(state, A).hp = 10;
    player(state, A).mana = 100;
    expect(castUltimate(state, A, "purple-void", "púrpura", START)).toMatchObject({ ok: true });
  });

  it("con vida > 30: REQUIREMENT_NOT_MET y no gasta maná", () => {
    const state = activeMatch({ ultimateA: "purple-void" });
    player(state, A).hp = 31;
    player(state, A).mana = 100;
    expect(castUltimate(state, A, "purple-void", "vacio", START)).toEqual({ ok: false, code: "REQUIREMENT_NOT_MET" });
    expect(player(state, A).mana).toBe(100);
  });

  it("curarse por encima de 30 lo vuelve a bloquear", () => {
    const state = activeMatch({ ultimateA: "purple-void" });
    player(state, A).hp = 25;
    player(state, A).mana = 100;
    castSpell(state, A, "heal", 0.9, START);
    player(state, A).mana = 100;
    expect(castUltimate(state, A, "purple-void", "vacio", START + GAP)).toEqual({ ok: false, code: "REQUIREMENT_NOT_MET" });
  });

  it("contra escudo hace la mitad (25) y el escudo desaparece", () => {
    const state = activeMatch({ ultimateA: "purple-void" });
    castSpell(state, B, "shield", 0.9, START);
    player(state, A).hp = 20;
    player(state, A).mana = 100;
    expect(castUltimate(state, A, "purple-void", "vacio", START + 100)).toMatchObject({ outcome: "reduced", damage: 25 });
    expect(player(state, B).shieldUntil).toBeNull();
  });

  it("una sola vez por partida", () => {
    const state = activeMatch({ ultimateA: "purple-void" });
    player(state, A).hp = 20;
    player(state, A).mana = 100;
    castUltimate(state, A, "purple-void", "vacio", START);
    player(state, A).mana = 100;
    expect(castUltimate(state, A, "purple-void", "vacio", START + GAP)).toEqual({ ok: false, code: "ALREADY_USED" });
    expect(player(state, A).mana).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Tabla de interacciones (sección 6)
// ---------------------------------------------------------------------------

describe("interacciones con el Escudo", () => {
  it.each(["lightning", "slash", "fireball", "poison", "freeze", "silence-seal"] as const)(
    "%s contra Escudo: absorbido por completo, sin efecto y el escudo desaparece",
    (spellId) => {
      const state = activeMatch();
      castSpell(state, B, "shield", 0.9, START);
      player(state, A).mana = 100;
      const result =
        spellId === "silence-seal" ? castSeal(state, A, START) : castSpell(state, A, spellId, 0.9, START + 100);
      expect(result).toMatchObject({ ok: true, outcome: "blocked", damage: 0 });
      advance(state, START + 10_000);
      expect(player(state, B).hp).toBe(100);
      expect(player(state, B).effects).toEqual([]);
      expect(player(state, B).silencedUntil).toBeNull();
      expect(player(state, B).shieldUntil).toBeNull();
    },
  );

  it("el Sello absorbido por el escudo se gasta igual (1 vez por partida)", () => {
    const state = activeMatch();
    castSpell(state, B, "shield", 0.9, START);
    player(state, A).mana = 100;
    castSeal(state, A, START);
    expect(player(state, A).used["silence-seal"]).toBe(true);
  });

  it("Tormenta contra Escudo no se bloquea y el escudo sigue", () => {
    const state = activeMatch({ ultimateA: "storm" });
    castSpell(state, B, "shield", 0.9, START);
    player(state, A).mana = 100;
    expect(castUltimate(state, A, "storm", "tormenta", START + 100)).toMatchObject({ ok: true, outcome: "hit" });
    expect(player(state, B).shieldUntil).toBe(START + 3_000);
    advance(state, START + 10_000);
    expect(player(state, B).hp).toBe(100 - ULTIMATES.storm.effect.storm.damagePerSecond * 5);
  });
});

describe("orden de llegada", () => {
  it("dos hechizos casi simultáneos se procesan en el orden en que llegan", () => {
    const state = activeMatch();
    // B lanza el escudo un instante antes del Rayo de A: el Rayo se bloquea.
    castSpell(state, B, "shield", 0.9, START);
    expect(castSpell(state, A, "lightning", 0.9, START)).toMatchObject({ outcome: "blocked" });
  });
});
