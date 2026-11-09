import type { SpellId } from "@duelo/contracts";
import { describe, expect, it } from "vitest";
import { classifyStroke, isStraightStroke } from "../src/classifier";
import { circlePoints, zigzagPoints } from "../src/templates";
import { handDrawnCircle, handDrawnZigzag, polyline, seededRandom, vary } from "./fixtures";

const FRAME_WIDTH = 640;
const P0_GRIMOIRE: SpellId[] = ["lightning", "shield"];

const classify = (points: Parameters<typeof classifyStroke>[0], grimoire = P0_GRIMOIRE) =>
  classifyStroke(points, { grimoire, frameWidth: FRAME_WIDTH });

describe("Rayo (zigzag)", () => {
  it("reconoce las plantillas exactas con confianza ~1", () => {
    const result = classify(vary(zigzagPoints(3, false), { offset: { x: 100, y: 200 } }));
    expect(result).toMatchObject({ kind: "spell", spellId: "lightning" });
    if (result.kind === "spell") expect(result.confidence).toBeGreaterThan(0.95);
  });

  const cases = [];
  for (const peaks of [3, 4, 5]) {
    for (const startUp of [true, false]) {
      for (const seed of [1, 2, 3]) cases.push({ peaks, startUp, seed });
    }
  }

  it.each(cases)("zigzag a mano: $peaks tramos, sube=$startUp, semilla=$seed", ({ peaks, startUp, seed }) => {
    const stroke = vary(handDrawnZigzag(peaks, startUp, seed), { scale: 0.6 + seed * 0.2, jitter: 3, seed });
    const result = classify(stroke);
    expect(result).toMatchObject({ kind: "spell", spellId: "lightning" });
  });
});

describe("Escudo (círculo)", () => {
  const cases = [];
  for (const clockwise of [true, false]) {
    for (const startDeg of [-90, 0, 135, 200]) cases.push({ clockwise, startDeg });
  }

  it.each(cases)("círculo a mano: horario=$clockwise, empieza en $startDeg°", ({ clockwise, startDeg }) => {
    const stroke = vary(handDrawnCircle({ clockwise, startDeg }), { scale: 0.8, jitter: 3, seed: startDeg + 400 });
    expect(classify(stroke)).toMatchObject({ kind: "spell", spellId: "shield" });
  });

  it("acepta una elipse y un círculo que no cierra del todo", () => {
    expect(classify(vary(handDrawnCircle({ clockwise: true, startDeg: 0, rx: 120, ry: 85 })))).toMatchObject({
      kind: "spell",
      spellId: "shield",
    });
    expect(classify(vary(handDrawnCircle({ clockwise: false, startDeg: 90, sweepDeg: 330 })))).toMatchObject({
      kind: "spell",
      spellId: "shield",
    });
  });

  it("la plantilla exacta da confianza ~1", () => {
    const result = classify(vary(circlePoints(true)));
    if (result.kind !== "spell") throw new Error(`esperaba spell, llegó ${result.kind}`);
    expect(result.confidence).toBeGreaterThan(0.95);
  });
});

describe("Rechazos", () => {
  it("un garabato aleatorio es hechizo fallido, no Rayo ni Escudo", () => {
    for (const seed of [11, 22, 33, 44, 55]) {
      const random = seededRandom(seed);
      const vertices = Array.from({ length: 8 }, () => ({ x: random() * 300, y: random() * 300 }));
      const result = classify(polyline(vertices));
      expect(result.kind, `semilla ${seed}`).toBe("failed");
    }
  });

  it("el $1 solo compara contra el grimorio: un círculo sin Escudo no puede ser Escudo", () => {
    const result = classify(vary(handDrawnCircle({ clockwise: true, startDeg: 0 })), ["lightning"]);
    expect(result.kind === "spell" && result.spellId === "shield").toBe(false);
    expect(result.kind).toBe("failed");
  });

  it("un trazo diminuto (pinza accidental) se ignora", () => {
    expect(classify(vary(handDrawnCircle({ clockwise: true, startDeg: 0, rx: 5, ry: 5 })))).toEqual({ kind: "ignored" });
  });
});

describe("Línea recta (no pasa por el $1)", () => {
  const line = polyline([{ x: 100, y: 300 }, { x: 400, y: 260 }]);

  it("detecta la rectitud según la sección 6", () => {
    expect(isStraightStroke(line, FRAME_WIDTH)).toBe(true);
    // Recta pero más corta que 1/4 del ancho.
    expect(isStraightStroke(polyline([{ x: 0, y: 0 }, { x: 120, y: 0 }]), FRAME_WIDTH)).toBe(false);
    expect(isStraightStroke(vary(zigzagPoints(3, false)), FRAME_WIDTH)).toBe(false);
  });

  it("sin Corte en el grimorio es hechizo fallido (nunca Rayo)", () => {
    expect(classify(line)).toEqual({ kind: "failed", bestGuess: null, confidence: 0 });
  });

  it("con Corte en el grimorio es Corte", () => {
    expect(classify(line, ["lightning", "shield", "slash"])).toEqual({ kind: "spell", spellId: "slash", confidence: 1 });
  });
});
