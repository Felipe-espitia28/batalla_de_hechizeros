/**
 * Simulador de la arena de entrenamiento: mismas reglas que el servidor, números de game-rules.
 */
import { MATCH_RULES, SPELLS, ULTIMATES } from "@duelo/game-rules";
import { describe, expect, it } from "vitest";
import {
  advance,
  castSpell,
  castUltimate,
  createPractice,
  failSpell,
  resetDummy,
  sealCharging,
  setInfiniteMana,
  toPlayerState,
} from "../src/practice/practice-sim";

const T0 = 1_000_000;
const practice = (spells = ["lightning", "shield", "fireball", "poison"] as const) =>
  createPractice([...spells], "meteor", T0);

describe("castSpell", () => {
  it("el Rayo daña al muñeco y gasta maná", () => {
    const s = practice();
    expect(castSpell(s, "lightning", 0.95, T0)).toEqual({ ok: true, outcome: "hit", damage: SPELLS.lightning.effect.damage });
    expect(s.dummy.hp).toBe(MATCH_RULES.maxHp - SPELLS.lightning.effect.damage);
    expect(s.player.mana).toBe(MATCH_RULES.startingMana - SPELLS.lightning.manaCost);
    expect(s.stats.casts).toBe(1);
  });

  it("respeta el cooldown, el intervalo mínimo y la falta de maná", () => {
    const s = practice();
    castSpell(s, "lightning", 0.95, T0);
    expect(castSpell(s, "shield", 0.95, T0 + 100)).toEqual({ ok: false, code: "RATE_LIMIT" });
    expect(castSpell(s, "lightning", 0.95, T0 + 400)).toEqual({ ok: false, code: "COOLDOWN" });
    s.player.mana = 5;
    expect(castSpell(s, "shield", 0.95, T0 + 800)).toEqual({ ok: false, code: "NO_MANA" });
    // Sin gastar: solo la regeneración de los 0,4 s transcurridos (+4/s).
    expect(s.player.mana).toBeCloseTo(5 + 0.4 * MATCH_RULES.manaRegenPerSecond, 5);
  });

  it("la confianza baja falla, cuenta y penaliza 500 ms sin gastar maná", () => {
    const s = practice();
    expect(castSpell(s, "lightning", 0.6, T0)).toEqual({ ok: false, code: "LOW_CONFIDENCE" });
    expect(s.stats.failed).toBe(1);
    expect(s.player.mana).toBe(MATCH_RULES.startingMana);
    expect(castSpell(s, "lightning", 0.95, T0 + 400)).toEqual({ ok: false, code: "RATE_LIMIT" });
    expect(castSpell(s, "lightning", 0.95, T0 + MATCH_RULES.failedCastPenaltyMs + 1).ok).toBe(true);
  });

  it("failSpell (gesto que el reconocedor rechazó) también penaliza", () => {
    const s = practice();
    failSpell(s, T0);
    expect(s.stats.failed).toBe(1);
    expect(castSpell(s, "lightning", 0.95, T0 + 400)).toEqual({ ok: false, code: "RATE_LIMIT" });
  });

  it("rechaza lo que no está en el grimorio", () => {
    expect(castSpell(practice(), "freeze", 0.95, T0)).toEqual({ ok: false, code: "NOT_IN_GRIMOIRE" });
  });

  it("la Bola de fuego quema 3 segundos", () => {
    const s = practice();
    s.player.mana = 100;
    castSpell(s, "fireball", 0.95, T0);
    const afterHit = MATCH_RULES.maxHp - SPELLS.fireball.effect.damage;
    expect(s.dummy.hp).toBe(afterHit);
    advance(s, T0 + 5_000);
    expect(s.dummy.hp).toBe(afterHit - 3 * SPELLS.fireball.effect.burn.damagePerSecond);
    expect(toPlayerState(s.dummy, T0 + 5_000).effects).toEqual([]);
  });

  it("el veneno drena maná del muñeco sin bajar de 0", () => {
    const s = practice();
    s.player.mana = 100;
    s.dummy.mana = 1;
    castSpell(s, "poison", 0.95, T0);
    advance(s, T0 + 7_000);
    expect(s.dummy.mana).toBeGreaterThanOrEqual(0);
    expect(s.dummy.hp).toBe(MATCH_RULES.maxHp - 6 * SPELLS.poison.effect.poison.damagePerSecond);
  });

  it("la Curación no pasa de 100 y el Escudo protege al jugador", () => {
    const s = createPractice(["lightning", "shield", "heal"], "meteor", T0);
    s.player.mana = 100;
    s.player.hp = 95;
    expect(castSpell(s, "heal", 0.95, T0)).toEqual({ ok: true, outcome: "self", damage: 0 });
    expect(s.player.hp).toBe(MATCH_RULES.maxHp);
    castSpell(s, "shield", 0.95, T0 + 400);
    expect(toPlayerState(s.player, T0 + 500).shieldUntil).not.toBeNull();
  });

  it("el Sello exige la X cargada al menos 0,6 s", () => {
    const s = createPractice(["lightning", "shield", "silence-seal"], "meteor", T0);
    s.player.mana = 100;
    expect(castSpell(s, "silence-seal", 0.95, T0)).toEqual({ ok: false, code: "SEAL_NOT_CHARGED" });
    sealCharging(s, T0 + 400);
    expect(castSpell(s, "silence-seal", 0.95, T0 + 400 + MATCH_RULES.sealMinChargeMs).ok).toBe(true);
    expect(toPlayerState(s.dummy, T0 + 1_100).silencedUntil).not.toBeNull();
  });
});

describe("castUltimate", () => {
  it("el Meteoro exige maná lleno y la palabra correcta", () => {
    const s = practice();
    expect(castUltimate(s, "meteor", "meteoro", T0)).toEqual({ ok: false, code: "NO_MANA" });
    s.player.mana = 100;
    expect(castUltimate(s, "meteor", "hola", T0 + 400)).toEqual({ ok: false, code: "LOW_CONFIDENCE" });
    expect(castUltimate(s, "meteor", "¡METEORO!", T0 + 800)).toEqual({
      ok: true,
      outcome: "hit",
      damage: ULTIMATES.meteor.effect.damage,
    });
  });

  it("el Vacío púrpura se puede practicar con la vida llena", () => {
    const s = createPractice(["lightning", "shield"], "purple-void", T0);
    s.player.mana = 100;
    expect(castUltimate(s, "purple-void", "vacio", T0).ok).toBe(true);
  });
});

describe("muñeco y controles", () => {
  it("al llegar a 0 cuenta un KO y vuelve a 100", () => {
    const s = practice();
    s.dummy.hp = 5;
    castSpell(s, "lightning", 0.95, T0);
    advance(s, T0 + 100);
    expect(s.stats.kos).toBe(1);
    expect(s.dummy.hp).toBe(MATCH_RULES.maxHp);
  });

  it("con maná infinito no se gasta maná", () => {
    const s = practice();
    setInfiniteMana(s, true);
    castSpell(s, "lightning", 0.95, T0);
    expect(s.player.mana).toBe(MATCH_RULES.maxMana);
  });

  it("resetDummy deja al muñeco como nuevo", () => {
    const s = practice();
    castSpell(s, "lightning", 0.95, T0);
    resetDummy(s);
    expect(s.dummy.hp).toBe(MATCH_RULES.maxHp);
    expect(s.dummy.effects).toEqual([]);
  });
});
