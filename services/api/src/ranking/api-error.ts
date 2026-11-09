import type { ApiErrorBody, ApiErrorCode } from "@duelo/contracts";
import type { ErrorRequestHandler, Response } from "express";

/** Error con código del contrato REST; el manejador de abajo lo convierte en `ApiErrorBody`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function sendApiError(res: Response, status: number, code: ApiErrorCode, message: string, details?: unknown) {
  const body: ApiErrorBody = { error: { code, message, ...(details === undefined ? {} : { details }) } };
  res.status(status).json(body);
}

/**
 * Manejador de errores propio de los routers de ranking. Express 5 ya reenvía aquí los errores de los
 * handlers async; tenerlo dentro del router garantiza el formato `ApiErrorBody` aunque la base del
 * servidor todavía no tenga uno global.
 */
export const rankingErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof ApiError) {
    sendApiError(res, err.status, err.code, err.message, err.details);
    return;
  }
  // JSON mal formado: express.json() lanza un error con status 400.
  if (typeof err === "object" && err !== null && "status" in err && err.status === 400) {
    sendApiError(res, 400, "VALIDATION_ERROR", "El cuerpo de la petición no es JSON válido.");
    return;
  }
  console.error("[ranking] error inesperado", err);
  sendApiError(res, 500, "INTERNAL_ERROR", "Error interno del servidor.");
};
