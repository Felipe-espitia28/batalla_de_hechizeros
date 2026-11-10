/**
 * Conexiones de prueba. Por defecto apuntan al docker-compose local; en CI llegan por variables.
 * Son credenciales locales sin valor (las mismas de docker-compose.yml), no secretos.
 */
export const TEST_DATABASE_URL =
  process.env["TEST_DATABASE_URL"] ?? "postgresql://duelo:duelo@localhost:5432/duelo_test";
// Base 15 de Redis: no se mezcla con la 0 que usa el api en desarrollo.
export const TEST_REDIS_URL = process.env["TEST_REDIS_URL"] ?? "redis://localhost:6379/15";

/** Las pruebas borran todo: nos negamos a correr contra una base que no se llame *test*. */
export function assertTestDatabase(url: string): void {
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) {
    throw new Error(`TEST_DATABASE_URL debe apuntar a una base de prueba (nombre con "test"); recibí "${dbName}".`);
  }
}
