import { describe, expect, it, vi } from "vitest";
import { ApiRequestError, createApiClient } from "../src/api.js";

const API = "http://api.test";

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("api client", () => {
  it("hace login con JSON y devuelve la respuesta", async () => {
    const fetchMock = respond(200, { token: "t", user: { id: "u1", username: "felipe" } });
    const api = createApiClient(API, fetchMock as unknown as typeof fetch);
    const result = await api.login({ identifier: "felipe", password: "secreto123" });
    expect(result.user.username).toBe("felipe");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API}/auth/login`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("manda el Bearer en /me", async () => {
    const fetchMock = respond(200, { id: "u1" });
    await createApiClient(API, fetchMock as unknown as typeof fetch).me("mi-token");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer mi-token");
  });

  it("convierte ApiErrorBody en ApiRequestError con su código y mensaje", async () => {
    const api = createApiClient(
      API,
      respond(409, { error: { code: "USERNAME_TAKEN", message: "Ese nombre de usuario ya está en uso" } }) as unknown as typeof fetch,
    );
    await expect(api.register({ username: "a", email: "a@b.co", password: "12345678" })).rejects.toMatchObject({
      status: 409,
      code: "USERNAME_TAKEN",
      message: "Ese nombre de usuario ya está en uso",
    });
  });

  it("distingue sesión expirada de credenciales inválidas", () => {
    expect(new ApiRequestError(401, "TOKEN_EXPIRED", "x").isSessionExpired).toBe(true);
    expect(new ApiRequestError(401, "UNAUTHORIZED", "x").isSessionExpired).toBe(true);
    expect(new ApiRequestError(401, "INVALID_CREDENTIALS", "x").isSessionExpired).toBe(false);
  });

  it("explica la falta de red y la falta de configuración", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(createApiClient(API, offline as unknown as typeof fetch).me("t")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    await expect(createApiClient(null).me("t")).rejects.toMatchObject({ code: "API_NOT_CONFIGURED" });
  });

  it("responde con un error genérico si el cuerpo no es ApiErrorBody", async () => {
    const api = createApiClient(API, vi.fn(async () => new Response("<html>502</html>", { status: 502 })) as unknown as typeof fetch);
    await expect(api.me("t")).rejects.toMatchObject({ status: 502, code: "INTERNAL_ERROR" });
  });
});
