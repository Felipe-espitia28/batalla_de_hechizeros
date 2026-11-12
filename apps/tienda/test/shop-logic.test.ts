/**
 * Lógica de la Tienda: estado de compra de cada hechizo y opciones del grimorio.
 */
import type { Grimoire } from "@duelo/contracts";
import { SPELL_CATALOG, SPELLS, ULTIMATES } from "@duelo/game-rules";
import { describe, expect, it } from "vitest";
import {
  describeEffect,
  describeStats,
  getSpellStatus,
  grimoireErrorsByField,
  sameGrimoire,
  slotOptions,
  ultimateOptions,
} from "../src/shop-logic";

const item = (id: string) => {
  const found = SPELL_CATALOG.find((s) => s.id === id);
  if (!found) throw new Error(`no existe ${id}`);
  return found;
};

const starter = new Set(["lightning", "shield", "meteor"]);
const initialGrimoire: Grimoire = { slots: ["lightning", "shield", null, null], ultimateId: "meteor" };

describe("getSpellStatus", () => {
  it("distingue inicial, comprado, alcanzable y caro", () => {
    const owned = new Set([...starter, "slash"]);
    expect(getSpellStatus(item("lightning"), owned, 0)).toBe("starter");
    expect(getSpellStatus(item("slash"), owned, 0)).toBe("owned");
    expect(getSpellStatus(item("fireball"), owned, 100)).toBe("affordable");
    expect(getSpellStatus(item("fireball"), owned, 99)).toBe("too-expensive");
  });

  it("vende los P2 igual que el resto: el game-server ya los resuelve", () => {
    const seal = item("silence-seal");
    const purpleVoid = item("purple-void");
    expect(getSpellStatus(seal, starter, seal.price)).toBe("affordable");
    expect(getSpellStatus(purpleVoid, starter, purpleVoid.price)).toBe("affordable");
    expect(getSpellStatus(seal, starter, seal.price - 1)).toBe("too-expensive");
    expect(getSpellStatus(item("storm"), new Set([...starter, "storm"]), 0)).toBe("owned");
  });
});

describe("slotOptions y ultimateOptions", () => {
  it("solo ofrece hechizos comprados, sin los fijos ni definitivos", () => {
    const owned = new Set([...starter, "freeze", "slash", "storm"]);
    expect(slotOptions(owned, initialGrimoire, 2)).toEqual(["slash", "freeze"]);
  });

  it("no ofrece el hechizo que ya ocupa el otro espacio libre", () => {
    const owned = new Set([...starter, "slash", "heal"]);
    const grimoire: Grimoire = { slots: ["lightning", "shield", "heal", null], ultimateId: "meteor" };
    expect(slotOptions(owned, grimoire, 3)).toEqual(["slash"]);
    expect(slotOptions(owned, grimoire, 2)).toEqual(["slash", "heal"]);
  });

  it("solo ofrece definitivos comprados, en orden de catálogo", () => {
    expect(ultimateOptions(new Set([...starter, "rebirth", "storm"]))).toEqual(["meteor", "storm", "rebirth"]);
  });
});

describe("textos del catálogo", () => {
  it("describe efecto y datos de combate desde game-rules", () => {
    expect(describeEffect(SPELLS.fireball)).toBe("15 de daño; quemadura de 2/s durante 3 s");
    expect(describeStats(SPELLS.lightning)).toBe("10 de maná · cooldown 1,5 s");
    expect(describeStats(SPELLS["silence-seal"])).toBe("70 de maná · 1 vez por partida");
    expect(describeStats(ULTIMATES["purple-void"])).toBe("100 de maná · 1 vez por partida · solo con 30 de vida o menos");
  });

  it("todo hechizo del catálogo tiene una descripción de efecto", () => {
    for (const spell of SPELL_CATALOG) {
      const def = spell.kind === "spell" ? SPELLS[spell.id as keyof typeof SPELLS] : ULTIMATES[spell.id as keyof typeof ULTIMATES];
      expect(describeEffect(def).length).toBeGreaterThan(0);
    }
  });
});

describe("utilidades del grimorio", () => {
  it("compara grimorios por contenido", () => {
    expect(sameGrimoire(initialGrimoire, { ...initialGrimoire, slots: [...initialGrimoire.slots] })).toBe(true);
    expect(sameGrimoire(initialGrimoire, { ...initialGrimoire, ultimateId: "storm" })).toBe(false);
  });

  it("agrupa los detalles de INVALID_GRIMOIRE por campo e ignora basura", () => {
    expect(
      grimoireErrorsByField([
        { field: "slots.2", message: "No tienes freeze" },
        { field: "ultimateId", message: "No tienes storm" },
        { nada: true },
      ]),
    ).toEqual({ "slots.2": "No tienes freeze", ultimateId: "No tienes storm" });
    expect(grimoireErrorsByField("x")).toEqual({});
  });
});
