/**
 * Script de oro para la demo: argumentos y transacción todo-o-nada contra PostgreSQL real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_DEMO_GOLD,
  DemoGoldError,
  grantDemoGold,
  parseDemoGoldArgs,
} from "../prisma/demo-gold.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { createTestPrisma, createUser } from "./helpers.js";

describe("parseDemoGoldArgs", () => {
  it("usa 1000 por defecto, ignora el -- de pnpm y quita repetidos", () => {
    expect(parseDemoGoldArgs(["--", "mago_uno", "mago_dos", "mago_uno"])).toEqual({
      usernames: ["mago_uno", "mago_dos"],
      amount: DEFAULT_DEMO_GOLD,
    });
  });

  it("acepta --amount 500 y --amount=500", () => {
    expect(parseDemoGoldArgs(["mago", "--amount", "500"]).amount).toBe(500);
    expect(parseDemoGoldArgs(["--amount=500", "mago"]).amount).toBe(500);
  });

  it("rechaza montos inválidos, opciones desconocidas y la falta de usuarios", () => {
    for (const argv of [["mago", "--amount", "0"], ["mago", "--amount", "-5"], ["mago", "--amount=1.5"], ["mago", "--amount=999999"]]) {
      expect(() => parseDemoGoldArgs(argv)).toThrow(DemoGoldError);
    }
    expect(() => parseDemoGoldArgs(["mago", "--password", "x"])).toThrow(/desconocida/);
    expect(() => parseDemoGoldArgs([])).toThrow(/al menos un/);
  });
});

describe("grantDemoGold (integración)", () => {
  const prefix = `dg_${Date.now().toString(36)}`;
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  it("suma el oro a cada usuario sin pisar el que ya tenía (sin distinguir mayúsculas)", async () => {
    await createUser(prisma, `${prefix}_a`, 0, 30);
    await createUser(prisma, `${prefix}_b`);

    const results = await grantDemoGold(prisma, {
      usernames: [`${prefix}_A`.toUpperCase(), `${prefix}_b`],
      amount: 1000,
    });

    expect(results).toEqual([
      { username: `${prefix}_a`, gold: 1030 },
      { username: `${prefix}_b`, gold: 1000 },
    ]);
  });

  it("si falta un usuario no cambia a ninguno", async () => {
    await createUser(prisma, `${prefix}_c`, 0, 5);

    await expect(
      grantDemoGold(prisma, { usernames: [`${prefix}_c`, `${prefix}_no_existe`], amount: 1000 }),
    ).rejects.toThrow(/no_existe/);

    const user = await prisma.user.findUniqueOrThrow({ where: { username: `${prefix}_c` } });
    expect(user.gold).toBe(5);
  });
});
