/**
 * Cliente del api con un fetch falso: errores del contrato, 401 y api caída.
 */
import { describe, expect, it, vi } from "vitest";
import { ShopApi, ShopApiError } from "../src/api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function createApi(response: Response | Error) {
  const fetchFn = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const onSessionExpired = vi.fn();
  const api = new ShopApi({ baseUrl: "https://api.test", token: "jwt-123", onSessionExpired, fetchFn });
  return { api, fetchFn, onSessionExpired };
}

describe("ShopApi", () => {
  it("compra con el token y el cuerpo esperados", async () => {
    const { api, fetchFn } = createApi(jsonResponse(200, { spellId: "slash", gold: 50 }));
    await expect(api.purchase("slash")).resolves.toEqual({ spellId: "slash", gold: 50 });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/shop/purchase");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ spellId: "slash" }));
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer jwt-123");
  });

  it("pide el catálogo sin token (es público)", async () => {
    const { api, fetchFn } = createApi(jsonResponse(200, { spells: [] }));
    await api.getSpells();
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("convierte ApiErrorBody en ShopApiError con código y detalles", async () => {
    const { api, onSessionExpired } = createApi(
      jsonResponse(409, {
        error: { code: "INSUFFICIENT_GOLD", message: "Te faltan 10 de oro", details: { gold: 40, price: 50 } },
      }),
    );
    const error = await api.purchase("slash").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShopApiError);
    expect(error).toMatchObject({ status: 409, code: "INSUFFICIENT_GOLD", details: { gold: 40, price: 50 } });
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("ante un 401 avisa que la sesión expiró", async () => {
    const { api, onSessionExpired } = createApi(
      jsonResponse(401, { error: { code: "TOKEN_EXPIRED", message: "La sesión expiró" } }),
    );
    await expect(api.getInventory()).rejects.toMatchObject({ status: 401, code: "TOKEN_EXPIRED" });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("si el api no responde lanza NETWORK con un mensaje para el jugador", async () => {
    const { api } = createApi(new TypeError("Failed to fetch"));
    await expect(api.getMe()).rejects.toMatchObject({ status: 0, code: "NETWORK" });
  });

  it("una respuesta de error sin el formato del contrato no rompe el cliente", async () => {
    const { api } = createApi(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(api.getMe()).rejects.toMatchObject({ status: 502, code: "INTERNAL_ERROR" });
  });
});
