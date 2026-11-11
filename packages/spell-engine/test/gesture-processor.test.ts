import { describe, expect, it } from "vitest";
import type { GestureResult } from "../src/gesture-processor";
import { GestureProcessor } from "../src/gesture-processor";
import { PinchDetector } from "../src/pinch";
import type { Point } from "../src/geometry";
import { handDrawnCircle, handDrawnZigzag, syntheticHand, vary } from "./fixtures";

const SIZE = { width: 640, height: 480 };

/** Simula: mano abierta → pinza → dibuja `path` → abre. Devuelve los resultados no nulos. */
function drawWithPinch(processor: GestureProcessor, path: Point[]) {
  let time = 0;
  const results: GestureResult[] = [];
  const frame = (tip: Point, pinched: boolean) => {
    time += 33;
    const result = processor.process({ hands: [syntheticHand(tip, pinched)], ...SIZE, time });
    if (result) results.push(result);
  };
  frame(path[0]!, false);
  // stableFrames = 2: hacen falta dos fotogramas en pinza antes de empezar.
  frame(path[0]!, true);
  frame(path[0]!, true);
  for (const p of path) frame(p, true);
  const last = path[path.length - 1]!;
  frame(last, false);
  frame(last, false);
  return results;
}

describe("PinchDetector", () => {
  it("necesita dos fotogramas seguidos para cerrar y para abrir", () => {
    const pinch = new PinchDetector();
    const tip = { x: 0, y: 0 };
    expect(pinch.update(syntheticHand(tip, true))).toBeNull();
    expect(pinch.update(syntheticHand(tip, true))).toBe("closed");
    expect(pinch.update(syntheticHand(tip, false))).toBeNull();
    expect(pinch.update(syntheticHand(tip, false))).toBe("opened");
  });

  it("un fotograma suelto de temblor no corta el trazo", () => {
    const pinch = new PinchDetector();
    const tip = { x: 0, y: 0 };
    pinch.update(syntheticHand(tip, true));
    pinch.update(syntheticHand(tip, true));
    expect(pinch.update(syntheticHand(tip, false))).toBeNull();
    expect(pinch.update(syntheticHand(tip, true))).toBeNull();
    expect(pinch.isPinched).toBe(true);
  });
});

describe("GestureProcessor", () => {
  it("pinza + círculo + soltar = Escudo", () => {
    const processor = new GestureProcessor({ grimoire: ["lightning", "shield"] });
    const results = drawWithPinch(processor, vary(handDrawnCircle({ clockwise: true, startDeg: -90 })));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: "spell", spellId: "shield" });
  });

  it("pinza + zigzag + soltar = Rayo", () => {
    const processor = new GestureProcessor({ grimoire: ["lightning", "shield"] });
    const results = drawWithPinch(processor, vary(handDrawnZigzag(3, false, 7)));
    expect(results[0]).toMatchObject({ kind: "spell", spellId: "lightning" });
  });

  it("expone la estela mientras se dibuja", () => {
    const processor = new GestureProcessor({ grimoire: ["shield"] });
    const tip = { x: 100, y: 100 };
    processor.process({ hands: [syntheticHand(tip, true)], ...SIZE, time: 0 });
    processor.process({ hands: [syntheticHand(tip, true)], ...SIZE, time: 33 });
    processor.process({ hands: [syntheticHand({ x: 150, y: 100 }, true)], ...SIZE, time: 66 });
    const snapshot = processor.getSnapshot();
    expect(snapshot.isPinched).toBe(true);
    expect(snapshot.stroke.length).toBeGreaterThan(1);
  });

  it("dos manos pausan y descartan el trazo en curso", () => {
    const processor = new GestureProcessor({ grimoire: ["shield"] });
    const tip = { x: 100, y: 100 };
    processor.process({ hands: [syntheticHand(tip, true)], ...SIZE, time: 0 });
    processor.process({ hands: [syntheticHand(tip, true)], ...SIZE, time: 33 });
    processor.process({ hands: [syntheticHand(tip, true), syntheticHand({ x: 400, y: 100 }, false)], ...SIZE, time: 66 });
    expect(processor.getSnapshot()).toMatchObject({ twoHandsPaused: true, stroke: [] });
  });

  it("perder la mano unos fotogramas no corta el trazo, pero perderla mucho sí", () => {
    const processor = new GestureProcessor({ grimoire: ["shield"], lostHandTimeoutMs: 250 });
    const tip = { x: 100, y: 100 };
    processor.process({ hands: [syntheticHand(tip, true)], ...SIZE, time: 0 });
    processor.process({ hands: [syntheticHand(tip, true)], ...SIZE, time: 33 });
    processor.process({ hands: [syntheticHand({ x: 140, y: 100 }, true)], ...SIZE, time: 66 });
    processor.process({ hands: [], ...SIZE, time: 200 });
    expect(processor.getSnapshot().stroke.length).toBeGreaterThan(0);
    processor.process({ hands: [], ...SIZE, time: 400 });
    expect(processor.getSnapshot().stroke).toEqual([]);
  });
});
