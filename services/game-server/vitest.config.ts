import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // La prueba con sockets reales espera una partida corta de verdad (≈2 s).
    testTimeout: 15_000,
  },
});
