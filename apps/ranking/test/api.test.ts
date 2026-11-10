import { describe, expect, it, vi } from "vitest";
import { createRankingApi, RankingApiError } from "../src/api";

const API = "http://api.test";

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

function callOf(fetchMock: ReturnType<typeof respond>) {
  return fetchMock.mock.calls[0] as unknown as [string, RequestInit];
}

describe("cliente del ranking", () => {
  it("pide el top sin token (es público) y con el límite", async () => {
    const fetchMock = respond(200, { entries: [] });
    await createRankingApi(API, fetchMock as unknown as typeof fetch).top(10);
    const [url, init] = callOf(fetchMock);
    expect(url).toBe(`${API}/ranking?limit=10`);
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("manda el Bearer en /ranking/me y /me/matches", async () => {
    const fetchMock = respond(200, {});
    const api = createRankingApi(API, fetchMock as unknown as typeof fetch);
    await api.me("mi-token");
    await api.history("mi-token", 5);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url]) => url)).toEqual([`${API}/ranking/me`, `${API}/me/matches?limit=5`]);
    for (const [, init] of calls) expect(new Headers(init.headers).get("Authorization")).toBe("Bearer mi-token");
  });

  it("convierte un 401 en un error de sesión expirada con el mensaje del api", async () => {
    const fetchMock = respond(401, { error: { code: "TOKEN_EXPIRED", message: "Tu sesión expiró" } });
    const error = await createRankingApi(API, fetchMock as unknown as typeof fetch).me("t").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RankingApiError);
    expect(error).toMatchObject({ status: 401, code: "TOKEN_EXPIRED", message: "Tu sesión expiró", isSessionExpired: true });
  });

  it("un 500 sin cuerpo del contrato no es sesión expirada", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    const error = await createRankingApi(API, fetchMock as unknown as typeof fetch).top().catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 500, code: "INTERNAL_ERROR", isSessionExpired: false });
  });

  it("explica el fallo de red como servidor dormido", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const error = await createRankingApi(API, fetchMock as unknown as typeof fetch).top().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "NETWORK_ERROR" });
    expect((error as Error).message).toMatch(/dormido/);
  });

  it("sin VITE_API_URL falla con un mensaje claro y sin llamar a la red", async () => {
    const fetchMock = respond(200, {});
    const error = await createRankingApi(null, fetchMock as unknown as typeof fetch).top().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "API_NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
