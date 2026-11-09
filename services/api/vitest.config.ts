import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // bcrypt y la primera consulta a la base pueden tardar más que el límite por defecto.
    testTimeout: 20_000,
  },
});
