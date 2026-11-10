import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { assertTestDatabase, TEST_DATABASE_URL } from "./test-env.js";

/**
 * Prepara la base de prueba una vez antes de todas las pruebas: aplica las migraciones reales
 * (`migrate deploy`, igual que en Render) y carga los hechizos iniciales.
 *
 * Se usan las migraciones y no `db push` a propósito: así las pruebas fallan si schema.prisma
 * y prisma/migrations dejan de coincidir, y existen las restricciones CHECK que solo están en el SQL.
 * Cada prueba ya vacía sus tablas con TRUNCATE; el seed es idempotente.
 */
export default function setup(): void {
  assertTestDatabase(TEST_DATABASE_URL);
  // Se invoca el CLI con el mismo Node: evita depender de .bin/prisma vs prisma.cmd según el sistema.
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL };
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { stdio: "inherit", env });
  execFileSync(process.execPath, [prismaCli, "db", "seed"], { stdio: "inherit", env });
}
