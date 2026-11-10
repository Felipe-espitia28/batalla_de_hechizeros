/**
 * Cliente del api para el Ranking: top, posición propia e historial (sección 8).
 * Convierte cualquier fallo en RankingApiError con el código del contrato (ApiErrorBody),
 * para que la interfaz muestre un mensaje concreto y nunca una pantalla en blanco.
 */
import type {
  ApiErrorBody,
  ApiErrorCode,
  MatchHistoryResponse,
  RankingMeResponse,
  RankingResponse,
} from "@duelo/contracts";

/** Códigos propios del cliente, para fallos que no vienen del api. */
export type ClientErrorCode = "NETWORK_ERROR" | "API_NOT_CONFIGURED";

export class RankingApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | ClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RankingApiError";
  }

  /** 401 = el token ya no sirve: el Ranking avisa al shell con duelo:session-expired. */
  get isSessionExpired(): boolean {
    return this.status === 401;
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

export interface RankingApi {
  top(limit?: number): Promise<RankingResponse>;
  me(token: string): Promise<RankingMeResponse>;
  history(token: string, limit?: number): Promise<MatchHistoryResponse>;
}

export function createRankingApi(baseUrl: string | null, fetchImpl: typeof fetch = fetch): RankingApi {
  async function get<T>(path: string, token?: string): Promise<T> {
    if (!baseUrl) {
      throw new RankingApiError(0, "API_NOT_CONFIGURED", "Falta VITE_API_URL: el Ranking no sabe dónde está el api.");
    }
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { headers });
    } catch {
      // Render free duerme el api y Neon suspende la base: el primer intento puede fallar.
      throw new RankingApiError(
        0,
        "NETWORK_ERROR",
        "No hay conexión con el servidor. Si estaba dormido, espera unos segundos y reintenta.",
      );
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (isApiErrorBody(body)) {
        throw new RankingApiError(response.status, body.error.code, body.error.message);
      }
      throw new RankingApiError(response.status, "INTERNAL_ERROR", `El servidor respondió ${response.status}.`);
    }
    return body as T;
  }

  return {
    // El top es público: no manda el token para que funcione aunque la sesión esté por vencer.
    top: (limit = 50) => get<RankingResponse>(`/ranking?limit=${limit}`),
    me: (token) => get<RankingMeResponse>("/ranking/me", token),
    history: (token, limit = 20) => get<MatchHistoryResponse>(`/me/matches?limit=${limit}`, token),
  };
}
