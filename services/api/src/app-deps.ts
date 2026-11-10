/**
 * Dependencias que recibe cada módulo. Se inyectan (en vez de importarlas como singletons)
 * para que los tests puedan levantar la app con otra base de datos, otro Redis u otras variables.
 */
import type { Env } from "./config/env.js";
import type { PrismaClient } from "./lib/prisma.js";
import type { Redis } from "./lib/redis.js";

export interface AppDeps {
  env: Env;
  prisma: PrismaClient;
  redis: Redis;
}
