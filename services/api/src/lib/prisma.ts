/**
 * Cliente de Prisma 7. Desde la versión 7 la conexión va por un "driver adapter":
 * aquí node-postgres (pg), que funciona igual con el Postgres local y con Neon.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

export type { PrismaClient };

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error("Falta DATABASE_URL para conectar con PostgreSQL");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
