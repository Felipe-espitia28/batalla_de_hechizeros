import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { assertTestDatabase, TEST_DATABASE_URL } from "./test-env.js";

/**
 * Sincroniza el esquema de la base de prueba una vez antes de todas las pruebas (la crea si no existe).
 * Sin --force-reset a propósito: cada prueba ya vacía las tablas con TRUNCATE, y un push normal
 * se detiene si un cambio de esquema fuera a perder datos en vez de borrarlo todo en silencio.
 */
export default function setup(): void {
  assertTestDatabase(TEST_DATABASE_URL);
  // Se invoca el CLI con el mismo Node: evita depender de .bin/prisma vs prisma.cmd según el sistema.
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "db", "push", "--url", TEST_DATABASE_URL], {
    stdio: "inherit",
  });
}
