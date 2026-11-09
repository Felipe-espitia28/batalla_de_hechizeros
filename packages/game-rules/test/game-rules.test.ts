import { SPELL_IDS, ULTIMATE_IDS } from "@duelo/contracts";
import { describe, expect, it } from "vitest";
import {
  GRIMOIRE_RULES,
  MATCH_RULES,
  SPELLS,
  SPELL_CATALOG,
  STARTER_SPELL_IDS,
  ULTIMATES,
  applyMatchReward,
  getPlayerOutcome,
  getRankForRating,
  getRatingRange,
  halveDamage,
  normalizeSpeech,
  transcriptMatchesUltimate,
} from "../src/index.js";

describe("catálogo", () => {
  it("tiene un hechizo por cada id del contrato y ninguno de más", () => {
    expect(Object.keys(SPELLS).sort()).toEqual([...SPELL_IDS].sort());
    expect(Object.keys(ULTIMATES).sort()).toEqual([...ULTIMATE_IDS].sort());
    for (const [key, def] of Object.entries({ ...SPELLS, ...ULTIMATES })) {
      expect(def.id).toBe(key);
    }
  });

  it("tiene los números de la tabla de hechizos de CLAUDE.md", () => {
    // [maná, cooldown ms, precio]
    const expected: Record<string, [number, number | null, number]> = {
      lightning: [10, 1_500, 0],
      shield: [20, 6_000, 0],
      slash: [6, 800, 50],
      fireball: [25, 4_000, 100],
      heal: [30, 10_000, 150],
      poison: [25, 8_000, 200],
      freeze: [35, 12_000, 250],
      "silence-seal": [70, null, 400],
    };
    for (const def of Object.values(SPELLS)) {
      expect([def.manaCost, def.cooldownMs, def.price], def.id).toEqual(expected[def.id]);
    }
    expect(SPELLS.lightning.effect.damage).toBe(10);
    expect(SPELLS.shield.effect.shieldDurationMs).toBe(3_000);
    expect(SPELLS.fireball.effect).toEqual({ damage: 15, burn: { damagePerSecond: 2, durationMs: 3_000 } });
    expect(SPELLS.poison.effect.poison).toEqual({ damagePerSecond: 2, manaDrainPerSecond: 3, durationMs: 6_000 });
    expect(SPELLS.freeze.effect.freeze).toEqual({ cooldownMultiplier: 2, durationMs: 5_000 });
    expect(SPELLS["silence-seal"].effect.silence).toEqual({ durationMs: 7_000, silencedManaRegenPerSecond: 8 });
    expect(SPELLS["silence-seal"].usesPerMatch).toBe(1);
  });

  it("tiene los números de la tabla de definitivos", () => {
    for (const def of Object.values(ULTIMATES)) expect(def.manaCost).toBe(100);
    expect(ULTIMATES.meteor.effect.damage).toBe(35);
    expect(ULTIMATES.storm.effect.storm).toEqual({ damagePerSecond: 8, durationMs: 5_000 });
    expect(ULTIMATES.rebirth.effect).toEqual({ heal: 40, cleanse: true });
    expect(ULTIMATES["purple-void"].effect.damage).toBe(50);
    expect(ULTIMATES["purple-void"].maxCasterHp).toBe(30);
    expect(ULTIMATES["purple-void"].usesPerMatch).toBe(1);
    expect([ULTIMATES.storm.price, ULTIMATES.rebirth.price, ULTIMATES["purple-void"].price]).toEqual([300, 300, 500]);
  });

  it("aplica las interacciones con el Escudo", () => {
    expect(SPELLS.lightning.shieldInteraction).toBe("absorbed");
    expect(ULTIMATES.meteor.shieldInteraction).toBe("halved");
    expect(ULTIMATES.storm.shieldInteraction).toBe("unblockable");
    expect(halveDamage(35)).toBe(17);
    expect(halveDamage(50)).toBe(25);
  });

  it("marca como iniciales solo Rayo, Escudo y Meteoro, con precio 0", () => {
    const starters = SPELL_CATALOG.filter((s) => s.isStarter).map((s) => s.id);
    expect(starters.sort()).toEqual([...STARTER_SPELL_IDS].sort());
    for (const s of SPELL_CATALOG.filter((item) => item.isStarter)) expect(s.price).toBe(0);
    expect(GRIMOIRE_RULES.fixedSpellIds).toEqual(["lightning", "shield"]);
    expect(GRIMOIRE_RULES.defaultUltimateId).toBe("meteor");
  });

  it("expone el catálogo ordenado y con sortOrder únicos", () => {
    expect(SPELL_CATALOG).toHaveLength(12);
    const orders = SPELL_CATALOG.map((s) => s.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(12);
  });
});

describe("reglas generales", () => {
  it("coinciden con la tabla de reglas", () => {
    expect(MATCH_RULES).toMatchObject({
      durationMs: 90_000,
      maxHp: 100,
      maxMana: 100,
      startingMana: 30,
      manaRegenPerSecond: 4,
      minConfidence: 0.8,
      failedCastPenaltyMs: 500,
      minCastIntervalMs: 300,
      reconnectGraceMs: 10_000,
    });
  });

  it("amplía el margen de rating cada 10 s y acepta a cualquiera tras 30 s", () => {
    expect(getRatingRange(0)).toBe(150);
    expect(getRatingRange(9_999)).toBe(150);
    expect(getRatingRange(10_000)).toBe(250);
    expect(getRatingRange(29_999)).toBe(350);
    expect(getRatingRange(30_000)).toBeNull();
  });
});

describe("rangos", () => {
  it.each([
    [0, "Grado 4"],
    [99, "Grado 4"],
    [100, "Grado 3"],
    [249, "Grado 3"],
    [250, "Grado 2"],
    [499, "Grado 2"],
    [500, "Grado 1"],
    [899, "Grado 1"],
    [900, "Grado Especial"],
    [5_000, "Grado Especial"],
    [-5, "Grado 4"],
  ] as const)("rating %i → %s", (rating, rank) => {
    expect(getRankForRating(rating)).toBe(rank);
  });
});

describe("economía", () => {
  it("interpreta el motivo de fin para cada jugador", () => {
    expect(getPlayerOutcome("KO", "a", "a")).toBe("win");
    expect(getPlayerOutcome("TIMEOUT", "a", "b")).toBe("loss");
    expect(getPlayerOutcome("DRAW", null, "a")).toBe("draw");
    expect(getPlayerOutcome("ABANDON", "a", "a")).toBe("stayed");
    expect(getPlayerOutcome("ABANDON", "a", "b")).toBe("abandoned");
  });

  it("aplica puntos y oro y calcula el rango nuevo", () => {
    expect(applyMatchReward(80, "win")).toEqual({ ratingDelta: 25, goldDelta: 50, newRating: 105, newRank: "Grado 3" });
    expect(applyMatchReward(100, "loss")).toEqual({ ratingDelta: -15, goldDelta: 20, newRating: 85, newRank: "Grado 4" });
    expect(applyMatchReward(40, "draw")).toEqual({ ratingDelta: 0, goldDelta: 30, newRating: 40, newRank: "Grado 4" });
    expect(applyMatchReward(0, "stayed")).toMatchObject({ ratingDelta: 25, goldDelta: 50 });
  });

  it("nunca deja el rating bajo 0", () => {
    expect(applyMatchReward(10, "loss")).toMatchObject({ ratingDelta: -10, newRating: 0 });
    expect(applyMatchReward(0, "abandoned")).toMatchObject({ ratingDelta: 0, goldDelta: 0, newRating: 0 });
  });
});

describe("voz", () => {
  it("normaliza minúsculas y tildes", () => {
    expect(normalizeSpeech("  ¡Vacío PÚRPURA!  ")).toBe("¡vacio purpura!");
  });

  it("acepta las palabras de cada definitivo como palabra completa", () => {
    expect(transcriptMatchesUltimate("meteor", "METEORO")).toBe(true);
    expect(transcriptMatchesUltimate("meteor", "¡meteoro ya!")).toBe(true);
    expect(transcriptMatchesUltimate("meteor", "meteorológico")).toBe(false);
    expect(transcriptMatchesUltimate("purple-void", "Púrpura")).toBe(true);
    expect(transcriptMatchesUltimate("purple-void", "vacío")).toBe(true);
    expect(transcriptMatchesUltimate("storm", "renacer")).toBe(false);
  });
});
