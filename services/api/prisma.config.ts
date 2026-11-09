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
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
