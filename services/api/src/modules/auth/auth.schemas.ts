/**
 * Validación de entrada de auth. Los tipos de salida coinciden con RegisterRequest / LoginRequest
 * de @duelo/contracts; el `satisfies` de abajo avisa en compilación si el contrato cambia.
 */
import { z } from "zod";
import type { LoginRequest, RegisterRequest } from "@duelo/contracts";

export const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "El usuario debe tener al menos 3 caracteres")
    .max(20, "El usuario puede tener máximo 20 caracteres")
    .regex(/^[A-Za-z0-9_]+$/, "El usuario solo puede tener letras, números y guion bajo"),
  email: z.string().trim().toLowerCase().pipe(z.email("Correo inválido")),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    // bcrypt ignora todo lo que pase de 72 bytes: mejor rechazarlo que truncarlo en silencio.
    .max(72, "La contraseña puede tener máximo 72 caracteres"),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Escribe tu usuario o correo"),
  password: z.string().min(1, "Escribe tu contraseña"),
});

// Comprobación en compilación: si el contrato cambia, esto deja de compilar.
type _RegisterMatches = z.infer<typeof registerSchema> extends RegisterRequest ? true : never;
type _LoginMatches = z.infer<typeof loginSchema> extends LoginRequest ? true : never;
export const schemasMatchContracts: [_RegisterMatches, _LoginMatches] = [true, true];
