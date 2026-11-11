import { describe, expect, it } from "vitest";
import { GestureProcessor } from "../src/gesture-processor";
import { INDEX_MCP, INDEX_TIP, type Hand } from "../src/hand";
import type { Point } from "../src/geometry";
import { SealDetector, angleBetween, segmentsIntersect } from "../src/seal-detector";

/** Mano sintética: solo importan el nudillo (5) y la punta (8) del índice. */
function hand(base: Point, tip: Point): Hand {
  const h: Hand = Array.from({ length: 21 }, () => ({ ...base }));
  h[INDEX_MCP] = { ...base };
  h[INDEX_TIP] = { ...tip };
  return h;
}

// Índices cruzados a 90°: (200,300)→(300,200) y (300,300)→(200,200), se cortan en (250,250).
const X = [hand({ x: 200, y: 300 }, { x: 300, y: 200 }), hand({ x: 300, y: 300 }, { x: 200, y: 200 })];
// Dos índices hacia arriba, separados: no se cruzan.
const PARALLEL = [hand({ x: 200, y: 300 }, { x: 200, y: 200 }), hand({ x: 300, y: 300 }, { x: 300, y: 200 })];
// Se cruzan, pero casi paralelos (≈28°).
const NARROW = [hand({ x: 240, y: 300 }, { x: 270, y: 180 }), hand({ x: 270, y: 300 }, { x: 240, y: 180 })];

describe("Geometría de la X", () => {
  it("intersección y ángulo", () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false);
    expect(angleBetween({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
  });

  it("la X a 90° cuenta; índices paralelos o casi paralelos no (45°–135°)", () => {
    const d = new SealDetector();
    expect(d.isCross(X)).toBe(true);
    expect(d.isCross(PARALLEL)).toBe(false);
    expect(d.isCross(NARROW)).toBe(false);
    expect(d.isCross([X[0]!])).toBe(false);
  });
});

describe("Tiempos del Sello", () => {
  it("carga al formar la X y se lanza a los 0,7 s", () => {
    const d = new SealDetector();
    expect(d.update(X, 0)).toEqual({ kind: "seal-charging" });
    expect(d.update(X, 350)).toBeNull();
    expect(d.progress(350)).toBeCloseTo(0.5);
    expect(d.update(X, 700)).toEqual({ kind: "seal-cast", confidence: 1 });
  });

  it("separar las manos antes de tiempo cancela (sin gastar maná: no hay seal-cast)", () => {
    const d = new SealDetector();
    d.update(X, 0);
    d.update(X, 300);
    expect(d.update(PARALLEL, 400)).toBeNull(); // dentro de la tolerancia
    expect(d.update(PARALLEL, 500)).toEqual({ kind: "seal-cancel" });
    expect(d.progress(500)).toBeNull();
  });

  it("un fotograma suelto sin X (mano perdida un instante) no cancela", () => {
    // Fotogramas cada ~33 ms, como la cámara; en el de 300 ms MediaPipe pierde una mano.
    const d = new SealDetector();
    for (let t = 0; t <= 266; t += 33) d.update(X, t);
    expect(d.update([X[0]!], 300)).toBeNull();
    expect(d.update(X, 333)).toBeNull();
    expect(d.update(X, 700)).toEqual({ kind: "seal-cast", confidence: 1 });
  });

  it("tras lanzar hay que deshacer la X antes de cargar otra", () => {
    const d = new SealDetector();
    d.update(X, 0);
    d.update(X, 700);
    expect(d.update(X, 1500)).toBeNull();
    d.update([], 1600);
    d.update([], 1800);
    expect(d.update(X, 1900)).toEqual({ kind: "seal-charging" });
  });
});

describe("El Sello en el procesador de gestos", () => {
  const frame = (hands: Hand[], time: number) => ({ hands, width: 640, height: 480, time });

  it("sin el Sello en el grimorio, dos manos solo pausan el dibujo", () => {
    const p = new GestureProcessor({ grimoire: ["lightning", "shield"] });
    expect(p.process(frame(X, 0))).toBeNull();
    expect(p.process(frame(X, 800))).toBeNull();
    expect(p.getSnapshot()).toMatchObject({ twoHandsPaused: true, sealProgress: null });
  });

  it("con el Sello: carga, círculo de progreso y lanzamiento", () => {
    const p = new GestureProcessor({ grimoire: ["lightning", "shield", "silence-seal"] });
    expect(p.process(frame(X, 0))).toEqual({ kind: "seal-charging" });
    p.process(frame(X, 350));
    expect(p.getSnapshot().sealProgress).toBeCloseTo(0.5);
    expect(p.process(frame(X, 700))).toEqual({ kind: "seal-cast", confidence: 1 });
  });
});
