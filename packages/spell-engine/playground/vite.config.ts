import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Playground independiente del monorepo de apps: solo sirve para probar el módulo local.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { port: 5180 },
});
