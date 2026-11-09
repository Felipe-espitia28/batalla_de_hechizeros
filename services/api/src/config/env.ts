/**
 * Variables de entorno validadas al arrancar. Si falta una, el proceso muere con un mensaje claro
 * en vez de fallar más tarde en medio de una petición (p. ej. firmar un JWT con secreto vacío).
 * Ninguna URL ni secreto se escribe en el código (sección 4 y 10 de CLAUDE.md).
 */
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url(),
  // 32 caracteres mínimo: un secreto corto se puede adivinar por fuerza bruta.
  JWT_SECRET: z.string().min(32, "JWT_SECRET debe tener al menos 32 caracteres"),
  INTERNAL_API_KEY: z.string().min(16, "INTERNAL_API_KEY debe tener al menos 16 caracteres"),
  // Lista separada por comas, p. ej. "https://duelohechiceros.qd.je,http://localhost:5173".
  ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  // Opcional hasta que el módulo de ranking lo use (dh:ranking).
  REDIS_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Variables de entorno inválidas en services/api:\n${problems}`);
  }
  return parsed.data;
}
