// Configuración de Prisma 7 (sustituye a la URL dentro de schema.prisma y a "prisma.seed" en package.json).
// En local la URL sale de services/api/.env; en Render y en CI, de las variables del entorno.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Sin `env()` a propósito: `prisma generate` (en el build de Render) no necesita base de datos
    // y env() fallaría si DATABASE_URL no existe en ese momento.
    url: process.env.DATABASE_URL,
  },
});
