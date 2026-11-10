import type { SpellId } from "@duelo/contracts";
import { describe, expect, it } from "vitest";
import { classifyStroke } from "../src/classifier";
import { polyline } from "./fixtures";
import { distort, samples } from "./hand-drawn";

const FRAME_WIDTH = 640;
/** Grimorio con todas las figuras de P1 a la vez: el caso más difícil para el $1. */
const ALL: SpellId[] = ["lightning", "shield", "slash", "fireball", "heal", "poison", "freeze"];

describe("Figuras de P1 con todo el grimorio", () => {
  it.each(samples().map((s) => [s.label, s] as const))("%s", (_label, sample) => {
    const result = classifyStroke(sample.points, { grimoire: ALL, frameWidth: FRAME_WIDTH });
    expect(result).toMatchObject({ kind: "spell", spellId: sample.expected });
  });

  it("con trazos más descuidados (±25°, temblor de 9 px) sigue sin confundirse", () => {
    const sloppy = samples().map((s, i) => ({ ...s, points: distort(s.points.map((p) => ({ x: p.x - 320, y: p.y - 240 })), 100 + i, { rotateDeg: 25, jitter: 9 }) }));
    const wrong = sloppy.filter((s) => {
      const r = classifyStroke(s.points, { grimoire: ALL, frameWidth: FRAME_WIDTH });
      return !(r.kind === "spell" && r.spellId === s.expected);
    });
    expect(wrong.map((s) => s.label)).toEqual([]);
  });
});

describe("El grimorio limita al $1", () => {
  it("nunca se lanza un hechizo que no esté en el grimorio", () => {
    const p0: SpellId[] = ["lightning", "shield"];
    for (const s of samples()) {
      const r = classifyStroke(s.points, { grimoire: p0, frameWidth: FRAME_WIDTH });
      if (r.kind === "spell") expect(p0, s.label).toContain(r.spellId);
    }
  });

  /**
   * Limitación conocida de comparar SOLO contra el grimorio (sección 6): una figura que el jugador
   * no tiene se parece a la más cercana que sí tiene (triángulo/cuadrado → Escudo ≈ 0,82–0,87).
   * Se deja documentado aquí; ver la propuesta en el PR.
   */
  it("documenta la limitación: un cuadrado sin Congelar puede salir como Escudo", () => {
    const square = samples().find((s) => s.expected === "freeze")!;
    const r = classifyStroke(square.points, { grimoire: ["lightning", "shield"], frameWidth: FRAME_WIDTH });
    expect(r).toMatchObject({ kind: "spell", spellId: "shield" });
  });
});

describe("Corte (línea recta, sin $1)", () => {
  it.each([
    ["horizontal", [{ x: 100, y: 240 }, { x: 500, y: 250 }]],
    ["vertical", [{ x: 320, y: 60 }, { x: 330, y: 420 }]],
    ["diagonal", [{ x: 120, y: 400 }, { x: 460, y: 80 }]],
  ])("línea %s con todo el grimorio = Corte", (_label, ends) => {
    const line = distort(polyline(ends.map((p) => ({ x: p.x - 320, y: p.y - 240 })), 30), 7, { rotateDeg: 0, jitter: 3 });
    expect(classifyStroke(line, { grimoire: ALL, frameWidth: FRAME_WIDTH })).toEqual({ kind: "spell", spellId: "slash", confidence: 1 });
  });
});
