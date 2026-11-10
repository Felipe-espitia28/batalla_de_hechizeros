/**
 * Cliente mínimo del api para el shell: auth y perfil.
 * Convierte cualquier fallo en ApiRequestError con el código del contrato (ApiErrorBody),
 * para que la interfaz muestre un mensaje concreto y nunca un error genérico.
 */
import type { ApiErrorBody, ApiErrorCode, AuthResponse, LoginRequest, MeResponse, RegisterRequest } from "@duelo/contracts";

/** Códigos propios del cliente, para fallos que no vienen del api. */
export type ClientErrorCode = "NETWORK_ERROR" | "API_NOT_CONFIGURED";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | ClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }

  /** 401 de una ruta protegida = la sesión ya no sirve. Un 401 del login son credenciales malas. */
  get isSessionExpired(): boolean {
    return this.status === 401 && (this.code === "UNAUTHORIZED" || this.code === "TOKEN_EXPIRED");
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiErrorBody).error?.code === "string"
  );
}

export interface ApiClient {
  login(input: LoginRequest): Promise<AuthResponse>;
  register(input: RegisterRequest): Promise<AuthResponse>;
  me(token: string): Promise<MeResponse>;
}

export function createApiClient(baseUrl: string | null, fetchImpl: typeof fetch = fetch): ApiClient {
  async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
    if (!baseUrl) {
      throw new ApiRequestError(0, "API_NOT_CONFIGURED", "Falta VITE_API_URL: el shell no sabe dónde está el api.");
    }
    const headers = new Headers(init.headers);
    if (init.body) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers });
    } catch {
      // En Render free el api puede estar dormido (~1 min en despertar): el mensaje lo dice.
      throw new ApiRequestError(
        0,
        "NETWORK_ERROR",
        "No hay conexión con el servidor. Si acaba de despertar, espera unos segundos y reintenta.",
      );
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (isApiErrorBody(body)) {
        throw new ApiRequestError(response.status, body.error.code, body.error.message);
      }
      throw new ApiRequestError(response.status, "INTERNAL_ERROR", `El servidor respondió ${response.status}.`);
    }
    return body as T;
  }

  return {
    login: (input) => request<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(input) }),
    register: (input) => request<AuthResponse>("/auth/register", { method: "POST", body: JSON.stringify(input) }),
    me: (token) => request<MeResponse>("/me", {}, token),
  };
}
