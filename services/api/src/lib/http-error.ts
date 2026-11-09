/**
 * Error de negocio con código del contrato. Los módulos lanzan HttpError y el middleware
 * de errores lo convierte en `ApiErrorBody`, así todas las rutas responden igual.
 */
import type { ApiErrorCode } from "@duelo/contracts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, "VALIDATION_ERROR", message, details);
export const unauthorized = (message = "Debes iniciar sesión") =>
  new HttpError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "No tienes permiso para esto") =>
  new HttpError(403, "FORBIDDEN", message);
export const notFound = (message = "Recurso no encontrado") =>
  new HttpError(404, "NOT_FOUND", message);
