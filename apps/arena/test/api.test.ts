import type { DueloEventName } from "@duelo/contracts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// emitDueloEvent despacha en `window`; en Node basta un EventTarget.
const events: { name: DueloEventName; detail: unknown }[] = [];
beforeAll(() => {
  const target = new EventTarget();
  for (const name of ["duelo:session-expired", "duelo:gold-changed", "duelo:match-ended"] as const) {
    target.addEventListener(name, (e) => events.push({ name, detail: (e as CustomEvent).detail }));
  }
  vi.stubGlobal("window", target);
});
afterEach(() => {
  events.length = 0;
});

// config lee VITE_API_URL al importarse: se fija antes del import dinámico.
vi.stubEnv("VITE_API_URL", "http://api.test/");
const { fetchGold, fetchGrimoire } = await import("../src/api");

const json = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("api de la Arena", () => {
  it("GET /me devuelve el oro y manda el JWT", async () => {
    const fetchImpl = json(200, { gold: 120 });
    expect(await fetchGold("tok", fetchImpl as unknown as typeof fetch)).toBe(120);
    expect(fetchImpl).toHaveBeenCalledWith("http://api.test/me", { headers: { Authorization: "Bearer tok" } });
    expect(events).toEqual([]);
  });

  it("un 401 emite duelo:session-expired", async () => {
    const fetchImpl = json(401, { error: { code: "TOKEN_EXPIRED", message: "expiró" } });
    expect(await fetchGold("tok", fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(events.map((e) => e.name)).toEqual(["duelo:session-expired"]);
  });

  it("api caído o 500: no cierra la sesión", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await fetchGold("tok", down as unknown as typeof fetch)).toBeNull();
    expect(await fetchGold("tok", json(500, {}) as unknown as typeof fetch)).toBeNull();
    expect(events).toEqual([]);
  });

  it("grimorio: usa los espacios llenos de /me/inventory", async () => {
    const fetchImpl = json(200, { items: [], grimoire: { slots: ["lightning", "shield", "fireball", null], ultimateId: "meteor" } });
    expect(await fetchGrimoire("tok", fetchImpl as unknown as typeof fetch)).toEqual(["lightning", "shield", "fireball"]);
  });

  it("grimorio: si el endpoint aún no existe (404) juega con Rayo y Escudo", async () => {
    expect(await fetchGrimoire("tok", json(404, {}) as unknown as typeof fetch)).toEqual(["lightning", "shield"]);
    expect(events).toEqual([]);
  });
});
