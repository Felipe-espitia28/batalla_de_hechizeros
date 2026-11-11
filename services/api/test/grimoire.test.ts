/**
 * Reglas del grimorio sin base de datos: corren siempre, también en CI sin Postgres.
 */
import { describe, expect, it } from "vitest";
import { buildGrimoire, findGrimoireProblems, grimoireSpells } from "../src/modules/shop/grimoire.js";

const starterOwned = new Set(["lightning", "shield", "meteor"]);
const richOwned = new Set([...starterOwned, "slash", "fireball", "storm"]);

describe("findGrimoireProblems", () => {
  it("acepta el grimorio inicial", () => {
    const problems = findGrimoireProblems(
      { slots: ["lightning", "shield", null, null], ultimateId: "meteor" },
      starterOwned,
    );
    expect(problems).toEqual([]);
  });

  it("acepta hechizos comprados en 3 y 4 y un definitivo comprado", () => {
    const problems = findGrimoireProblems(
      { slots: ["lightning", "shield", "fireball", "slash"], ultimateId: "storm" },
      richOwned,
    );
    expect(problems).toEqual([]);
  });

  it("exige exactamente 4 espacios", () => {
    const problems = findGrimoireProblems({ slots: ["lightning", "shield", null], ultimateId: "meteor" }, starterOwned);
    expect(problems.map((p) => p.field)).toEqual(["slots"]);
  });

  it("exige Rayo y Escudo fijos en los espacios 1 y 2", () => {
    const problems = findGrimoireProblems(
      { slots: ["shield", "slash", null, null], ultimateId: "meteor" },
      richOwned,
    );
    expect(problems.map((p) => p.field)).toEqual(["slots.0", "slots.1"]);
  });

  it("rechaza hechizos que el jugador no tiene", () => {
    const problems = findGrimoireProblems(
      { slots: ["lightning", "shield", "freeze", null], ultimateId: "purple-void" },
      richOwned,
    );
    expect(problems.map((p) => p.field)).toEqual(["slots.2", "ultimateId"]);
  });

  it("rechaza repetidos, ids desconocidos y definitivos en los espacios de hechizos", () => {
    expect(
      findGrimoireProblems({ slots: ["lightning", "shield", "slash", "slash"], ultimateId: "meteor" }, richOwned).map(
        (p) => p.field,
      ),
    ).toEqual(["slots.3"]);
    expect(
      findGrimoireProblems({ slots: ["lightning", "shield", "lightning", null], ultimateId: "meteor" }, richOwned).map(
        (p) => p.field,
      ),
    ).toEqual(["slots.2"]);
    expect(
      findGrimoireProblems({ slots: ["lightning", "shield", "storm", "dragon"], ultimateId: "meteor" }, richOwned).map(
        (p) => p.field,
      ),
    ).toEqual(["slots.2", "slots.3"]);
  });

  it("rechaza un hechizo normal como definitivo", () => {
    const problems = findGrimoireProblems(
      { slots: ["lightning", "shield", null, null], ultimateId: "slash" },
      richOwned,
    );
    expect(problems.map((p) => p.field)).toEqual(["ultimateId"]);
  });
});

describe("buildGrimoire y grimoireSpells", () => {
  it("fuerza Rayo y Escudo aunque falten filas y deja vacíos los espacios sin hechizo", () => {
    const grimoire = buildGrimoire([{ slot: 4, spellId: "heal" }], "meteor");
    expect(grimoire).toEqual({ slots: ["lightning", "shield", null, "heal"], ultimateId: "meteor" });
    expect(grimoireSpells(grimoire)).toEqual(["lightning", "shield", "heal"]);
  });

  it("vuelve a Meteoro si el definitivo guardado no es válido", () => {
    expect(buildGrimoire([], "slash").ultimateId).toBe("meteor");
  });
});
