/**
 * HttpInternalApi contra un servidor HTTP local que imita al api: códigos de error,
 * timeout, cabecera interna y reintentos del registro de partidas.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { LoadoutResponse, RecordMatchRequest } from "@duelo/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { HttpInternalApi, InternalApiError } from "../src/internal-api.js";

const KEY = "clave-interna-de-prueba";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let server: Server | null = null;

async function fakeApi(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  // closeAllConnections corta también las peticiones que el test dejó colgadas a propósito.
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

const loadout: LoadoutResponse = {
  userId: USER,
  username: "ana",
  rating: 120,
  rank: "Grado 3",
  spells: ["lightning", "shield"],
  ultimateId: "meteor",
};

const record: RecordMatchRequest = {
  matchId: "m_test",
  endReason: "KO",
  winnerId: USER,
  durationMs: 1_000,
  startedAt: 1,
  endedAt: 1_001,
  players: [
    { userId: USER, finalHp: 100, abandoned: false },
    { userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", finalHp: 0, abandoned: false },
  ],
};

async function expectApiError(promise: Promise<unknown>, status: number | null): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(InternalApiError);
  expect((error as InternalApiError).status).toBe(status);
}

describe("HttpInternalApi.getLoadout", () => {
  it("envía la clave interna y devuelve el loadout", async () => {
    let receivedKey: string | undefined;
    let receivedUrl: string | undefined;
    const baseUrl = await fakeApi((req, res) => {
      receivedKey = req.headers["x-internal-key"] as string;
      receivedUrl = req.url;
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(loadout));
    });
    const api = new HttpInternalApi({ baseUrl, internalKey: KEY });
    expect(await api.getLoadout(USER)).toEqual(loadout);
    expect(receivedKey).toBe(KEY);
    expect(receivedUrl).toBe(`/internal/users/${USER}/loadout`);
  });

  it.each([404, 401, 500, 503])("un %i es InternalApiError con su código (nunca 'usuario desconocido')", async (code) => {
    const baseUrl = await fakeApi((_req, res) => res.writeHead(code).end());
    await expectApiError(new HttpInternalApi({ baseUrl, internalKey: KEY }).getLoadout(USER), code);
  });

  it("un timeout es InternalApiError sin código", async () => {
    // El servidor nunca responde.
    const baseUrl = await fakeApi(() => {});
    const api = new HttpInternalApi({ baseUrl, internalKey: KEY, loadoutTimeoutMs: 100 });
    await expectApiError(api.getLoadout(USER), null);
  });

  it("api apagado es InternalApiError sin código", async () => {
    const baseUrl = await fakeApi(() => {});
    server!.close();
    server = null;
    await expectApiError(new HttpInternalApi({ baseUrl, internalKey: KEY }).getLoadout(USER), null);
  });
});

describe("HttpInternalApi.recordMatch", () => {
  it("reintenta un 5xx y devuelve las recompensas cuando el api responde", async () => {
    let calls = 0;
    const baseUrl = await fakeApi((_req, res) => {
      calls++;
      if (calls < 3) return void res.writeHead(503).end();
      res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ rewards: {} }));
    });
    const api = new HttpInternalApi({ baseUrl, internalKey: KEY, retryDelayMs: 5 });
    expect(await api.recordMatch(record)).toEqual({ rewards: {} });
    expect(calls).toBe(3);
  });

  it("no reintenta un 4xx (payload o clave inválidos)", async () => {
    let calls = 0;
    const baseUrl = await fakeApi((_req, res) => {
      calls++;
      res.writeHead(400).end();
    });
    const api = new HttpInternalApi({ baseUrl, internalKey: KEY, retryDelayMs: 5 });
    await expectApiError(api.recordMatch(record), 400);
    expect(calls).toBe(1);
  });

  it("se rinde tras recordAttempts intentos", async () => {
    let calls = 0;
    const baseUrl = await fakeApi((_req, res) => {
      calls++;
      res.writeHead(500).end();
    });
    const api = new HttpInternalApi({ baseUrl, internalKey: KEY, retryDelayMs: 5, recordAttempts: 4 });
    await expectApiError(api.recordMatch(record), 500);
    expect(calls).toBe(4);
  });
});
