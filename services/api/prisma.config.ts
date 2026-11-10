import { defineConfig } from "prisma/config";

// Node 22+ trae su propio lector de .env: evitamos la dependencia dotenv.
// En Render y en CI no hay .env (las variables llegan del entorno), por eso el fallo se ignora.
try {
  process.loadEnvFile();
} catch {
  // sin .env: se usan las variables del entorno
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // El proceso del seed hereda las variables que ya cargó este archivo.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Sin env() a propósito: `prisma generate` (build de Render, postinstall) no necesita base
    // de datos y env() fallaría si DATABASE_URL no existe en ese momento.
    url: process.env["DATABASE_URL"],
  },
});
