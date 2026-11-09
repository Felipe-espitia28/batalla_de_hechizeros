/**
 * Valida un cuerpo o query con zod y lanza 400 con el detalle por campo.
 * Lo usan todos los módulos para que los errores de validación tengan la misma forma.
 */
import type { z } from "zod";
import { badRequest } from "./http-error.js";

export function parseOrThrow<Schema extends z.ZodType>(schema: Schema, input: unknown): z.infer<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw badRequest(fields[0]?.message ?? "Datos inválidos", fields);
  }
  return result.data;
}
