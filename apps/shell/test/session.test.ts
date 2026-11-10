import { describe, expect, it } from "vitest";
import { SESSION_KEY, clearSession, loadSession, saveSession, tokenExpiresAt, type KeyValueStore } from "../src/session.js";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

/** JWT sin firma válida: el shell solo lee `exp`, la firma la verifica el servidor. */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.firma`;
}

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const user = { id: "6f1c2a8e-0000-4000-8000-000000000001", username: "felipe" };

describe("session", () => {
  it("guarda y vuelve a leer una sesión vigente", () => {
    const store = memoryStore();
    const session = { token: fakeJwt({ sub: user.id, exp: NOW / 1000 + 3600 }), user };
    saveSession(store, session);
    expect(loadSession(store, NOW)).toEqual(session);
  });

  it("descarta y borra una sesión con el token vencido", () => {
    const store = memoryStore();
    saveSession(store, { token: fakeJwt({ sub: user.id, exp: NOW / 1000 - 1 }), user });
    expect(loadSession(store, NOW)).toBeNull();
    expect(store.data[SESSION_KEY]).toBeUndefined();
  });

  it("descarta datos corruptos o con otra forma", () => {
    expect(loadSession(memoryStore({ [SESSION_KEY]: "{no es json" }), NOW)).toBeNull();
    const wrongShape = memoryStore({ [SESSION_KEY]: JSON.stringify({ token: 1 }) });
    expect(loadSession(wrongShape, NOW)).toBeNull();
    expect(wrongShape.data[SESSION_KEY]).toBeUndefined();
  });

  it("no revienta si el almacenamiento está bloqueado", () => {
    const blocked: KeyValueStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(loadSession(blocked, NOW)).toBeNull();
    expect(() => saveSession(blocked, { token: "x", user })).not.toThrow();
    expect(() => clearSession(blocked)).not.toThrow();
  });

  it("lee exp del JWT y devuelve null si no se puede", () => {
    expect(tokenExpiresAt(fakeJwt({ exp: 1_800_000_000 }))).toBe(1_800_000_000_000);
    expect(tokenExpiresAt("basura")).toBeNull();
    expect(tokenExpiresAt(fakeJwt({ sub: "sin-exp" }))).toBeNull();
  });
});
