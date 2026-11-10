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
    expect(nextRankProgress(0)).toEqual({ next: "Grado 3", missing: 100 });
    expect(nextRankProgress(99)).toEqual({ next: "Grado 3", missing: 1 });
    expect(nextRankProgress(100)).toEqual({ next: "Grado 2", missing: 150 });
    expect(nextRankProgress(899)).toEqual({ next: "Grado Especial", missing: 1 });
    expect(nextRankProgress(900)).toBeNull();
  });
});
