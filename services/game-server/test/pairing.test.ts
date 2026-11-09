import { describe, expect, it } from "vitest";
import { findPairs, type QueueEntry } from "../src/matchmaking/pairing.js";

const entry = (userId: string, rating: number, joinedAt: number): QueueEntry => ({ userId, rating, joinedAt });
const ids = (pairs: Array<[QueueEntry, QueueEntry]>) => pairs.map(([a, b]) => [a.userId, b.userId]);

describe("matchmaking", () => {
  it("empareja rivales a ≤ 150 puntos de inmediato", () => {
    expect(ids(findPairs([entry("a", 100, 0), entry("b", 250, 0)], 0))).toEqual([["a", "b"]]);
  });

  it("no empareja a 200 puntos hasta que el margen crece a los 10 s", () => {
    const queue = [entry("a", 0, 0), entry("b", 200, 0)];
    expect(findPairs(queue, 9_999)).toEqual([]);
    expect(ids(findPairs(queue, 10_000))).toEqual([["a", "b"]]);
  });

  it("tras 30 s acepta a cualquier rival", () => {
    const queue = [entry("a", 0, 0), entry("b", 2_000, 0)];
    expect(findPairs(queue, 29_999)).toEqual([]);
    expect(ids(findPairs(queue, 30_000))).toEqual([["a", "b"]]);
  });

  it("prioriza a quien lleva más tiempo y elige el rating más cercano", () => {
    const queue = [entry("nuevo", 120, 5_000), entry("viejo", 100, 0), entry("cerca", 105, 4_000)];
    expect(ids(findPairs(queue, 6_000))).toEqual([["viejo", "cerca"]]);
  });

  it("nunca pone a un jugador en dos parejas", () => {
    const queue = [entry("a", 0, 0), entry("b", 0, 1), entry("c", 0, 2), entry("d", 0, 3), entry("e", 0, 4)];
    const pairs = findPairs(queue, 10);
    expect(pairs).toHaveLength(2);
    const all = pairs.flat().map((p) => p.userId);
    expect(new Set(all).size).toBe(4);
  });
});
