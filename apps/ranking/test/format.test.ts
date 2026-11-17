import { describe, expect, it } from "vitest";
import { formatDelta, formatDuration, nextRankProgress } from "../src/format";

describe("formatos", () => {
  it("muestra los deltas con signo", () => {
    expect([25, -15, 0].map(formatDelta)).toEqual(["+25", "−15", "0"]);
  });

  it("muestra la duración en minutos:segundos", () => {
    expect([0, 9_400, 65_000, 90_000].map(formatDuration)).toEqual(["0:00", "0:09", "1:05", "1:30"]);
  });

  it("calcula lo que falta para el siguiente rango con la tabla de game-rules", () => {
    expect(nextRankProgress(0)).toMatchObject({ next: "Grado 3", missing: 100 });
    expect(nextRankProgress(99)).toMatchObject({ next: "Grado 3", missing: 1 });
    expect(nextRankProgress(100)).toMatchObject({ next: "Grado 2", missing: 150 });
    expect(nextRankProgress(899)).toMatchObject({ next: "Grado Especial", missing: 1 });
    expect(nextRankProgress(900)).toBeNull();
  });

  it("calcula el avance de la barra desde el mínimo del rango actual", () => {
    expect(nextRankProgress(0)?.percent).toBe(0);
    expect(nextRankProgress(70)?.percent).toBeCloseTo(0.7); // 70 de 0–100 → Grado 3
    expect(nextRankProgress(175)?.percent).toBeCloseTo(0.5); // 175 de 100–250 → Grado 2
    expect(nextRankProgress(500)?.percent).toBe(0); // recién llegado a Grado 1
  });
});
