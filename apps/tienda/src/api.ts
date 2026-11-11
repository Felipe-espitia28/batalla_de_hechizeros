/**
 * Cliente REST de la Tienda. Todas las respuestas de error del api tienen la forma ApiErrorBody;
 * aquí se convierten en ShopApiError para que la interfaz muestre el mensaje correcto.
 *
 * `fetch` y `onSessionExpired` se inyectan para poder probarlo sin navegador.
 * En la app real, onSessionExpired emite `duelo:session-expired` y el shell lleva al login.
 */
import type {
  ApiErrorBody,
  ApiErrorCode,
  AnySpellId,
  Grimoire,
  InventoryResponse,
  MeResponse,
  PurchaseResponse,
  SpellsResponse,
  UpdateGrimoireResponse,
} from "@duelo/contracts";

/** NETWORK: el api no respondió (caído, sin internet o Render despertando). */
export type ShopErrorCode = ApiErrorCode | "NETWORK";

export class ShopApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ShopErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ShopApiError";
  }
}

export interface ShopApiOptions {
  baseUrl: string;
  token: string;
  onSessionExpired: () => void;
  fetchFn?: typeof fetch;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiErrorBody).error?.code === "string"
  );
}

export class ShopApi {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: ShopApiOptions) {
    // bind: llamar a window.fetch fuera de window lanza "Illegal invocation" en algunos navegadores.
    this.fetchFn = options.fetchFn ?? fetch.bind(globalThis);
  }

  getSpells(): Promise<SpellsResponse> {
    // Público: sin token, así el catálogo carga aunque la sesión haya expirado.
    return this.request<SpellsResponse>("/spells", { auth: false });
  }

  getMe(): Promise<MeResponse> {
    return this.request<MeResponse>("/me");
  }

  getInventory(): Promise<InventoryResponse> {
    return this.request<InventoryResponse>("/me/inventory");
  }

  purchase(spellId: AnySpellId): Promise<PurchaseResponse> {
    return this.request<PurchaseResponse>("/shop/purchase", { method: "POST", body: { spellId } });
  }

  saveGrimoire(grimoire: Grimoire): Promise<UpdateGrimoireResponse> {
    return this.request<UpdateGrimoireResponse>("/me/grimoire", { method: "PUT", body: grimoire });
  }

  private async request<T>(
    path: string,
    { method = "GET", body, auth = true }: { method?: string; body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (auth) headers["Authorization"] = `Bearer ${this.options.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await this.fetchFn(`${this.options.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ShopApiError(
        0,
        "NETWORK",
        "No se pudo conectar con el servidor. Si estaba dormido, tarda cerca de un minuto en despertar.",
      );
    }

    const payload: unknown = await response.json().catch(() => null);

    if (response.ok) return payload as T;

    if (response.status === 401) {
      // Sección 11: cualquier 401 avisa al shell, que vuelve al login.
      this.options.onSessionExpired();
    }
    if (isApiErrorBody(payload)) {
      throw new ShopApiError(response.status, payload.error.code, payload.error.message, payload.error.details);
    }
    throw new ShopApiError(response.status, "INTERNAL_ERROR", `El servidor respondió ${response.status}`);
  }
}
