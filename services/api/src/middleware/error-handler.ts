/**
 * Último middleware de la app: convierte cualquier error en `ApiErrorBody`.
 * Express 5 ya envía aquí los errores de handlers async, así que las rutas solo hacen `throw`.
 */
import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ApiErrorBody } from "@duelo/contracts";
import { HttpError } from "../lib/http-error.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiErrorBody = {
    error: { code: "NOT_FOUND", message: `Ruta no encontrada: ${req.method} ${req.path}` },
  };
  res.status(404).json(body);
};

/** Errores de body-parser (JSON mal formado o demasiado grande) traen `type` y `status`. */
function isBodyParserError(error: unknown): error is { type: string; status: number } {
  return typeof error === "object" && error !== null && "type" in error && "status" in error;
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof HttpError) {
    const body: ApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
    res.status(error.status).json(body);
    return;
  }

  if (isBodyParserError(error)) {
    const body: ApiErrorBody = {
      error: { code: "VALIDATION_ERROR", message: "El cuerpo de la petición no es JSON válido" },
    };
    res.status(error.status === 413 ? 413 : 400).json(body);
    return;
  }

  // Inesperado: se registra completo en el log del servidor, pero al cliente no se le filtran detalles.
  console.error("[api] error no controlado:", error);
  const body: ApiErrorBody = {
    error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" },
  };
  res.status(500).json(body);
};
