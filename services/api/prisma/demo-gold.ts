/**
 * Oro para las cuentas de la demo — dueño: Angel Arenales.
 *
 * Sección 6 de CLAUDE.md: una cuenta nueva empieza con 0 de oro, así que para mostrar la Tienda en la
 * sustentación hay que preparar cuentas con oro. Este script suma oro a cuentas YA registradas
 * (se crean desde el shell, como cualquier jugador); no crea usuarios ni guarda contraseñas.
 *
 * Uso:
 *   pnpm --filter @duelo/api db:demo-gold -- mago_uno mago_dos            (suma 1000 a cada uno)
 *   pnpm --filter @duelo/api db:demo-gold -- mago_uno --amount 500
 *
 * La base sale de DATABASE_URL (services/api/.env en local; en Neon, la de Bitwarden).
 * Todo o nada: si falta un usuario no se toca a ninguno, para no dejar la demo a medias sin notarlo.
 */
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "../src/lib/prisma.js";

export const DEFAULT_DEMO_GOLD = 1000;
/** Límite sensato: evita un error de tipeo (10000000) que vuelva inútil la economía en la demo. */
export const MAX_DEMO_GOLD = 100_000;

export interface DemoGoldArgs {
  usernames: string[];
  amount: number;
}

export interface DemoGoldResult {
  username: string;
  gold: number;
}

export class DemoGoldError extends Error {}

/** Lee `usuario1 usuario2 --amount 500` (también `--amount=500`). Ignora el `--` que agrega pnpm. */
export function parseDemoGoldArgs(argv: readonly string[]): DemoGoldArgs {
  const usernames: string[] = [];
  let amount = DEFAULT_DEMO_GOLD;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (arg === "--") continue;
    if (arg === "--amount" || arg.startsWith("--amount=")) {
      const raw = arg.includes("=") ? arg.slice("--amount=".length) : argv[++index];
      amount = Number(raw);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new DemoGoldError(`Opción desconocida: ${arg}`);
    }
    usernames.push(arg.trim());
  }

  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_DEMO_GOLD) {
    throw new DemoGoldError(`--amount debe ser un entero entre 1 y ${MAX_DEMO_GOLD}`);
  }
  const unique = [...new Set(usernames.filter(Boolean))];
  if (unique.length === 0) {
    throw new DemoGoldError("Indica al menos un nombre de usuario");
  }
  return { usernames: unique, amount };
}

/**
 * Suma `amount` de oro a cada usuario en una sola transacción.
 * El nombre se busca sin distinguir mayúsculas, igual que el login de Felipe.
 */
export async function grantDemoGold(prisma: PrismaClient, { usernames, amount }: DemoGoldArgs): Promise<DemoGoldResult[]> {
  return prisma.$transaction(async (tx) => {
    const results: DemoGoldResult[] = [];
    const missing: string[] = [];
    for (const username of usernames) {
      const user = await tx.user.findFirst({
        where: { username: { equals: username, mode: "insensitive" } },
        select: { id: true },
      });
      if (!user) {
        missing.push(username);
        continue;
      }
      // increment en el mismo UPDATE: no pisa oro ganado en una partida que cierre a la vez.
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { gold: { increment: amount } },
        select: { username: true, gold: true },
      });
      results.push(updated);
    }
    if (missing.length > 0) {
      // Lanzar dentro de la transacción la deshace: ningún usuario queda con el oro sumado.
      throw new DemoGoldError(`No existen estos usuarios: ${missing.join(", ")}. No se cambió nada.`);
    }
    return results;
  });
}

async function main(): Promise<void> {
  let args: DemoGoldArgs;
  try {
    args = parseDemoGoldArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${(error as Error).message}\nUso: pnpm --filter @duelo/api db:demo-gold -- usuario1 usuario2 [--amount 1000]`);
    process.exitCode = 1;
    return;
  }

  // Import dinámico: los tests importan este archivo sin necesitar DATABASE_URL.
  const { createPrismaClient } = await import("../src/lib/prisma.js");
  const prisma = createPrismaClient();
  try {
    const results = await grantDemoGold(prisma, args);
    for (const { username, gold } of results) {
      console.log(`+${args.amount} de oro a ${username} → ahora tiene ${gold}`);
    }
  } catch (error) {
    console.error(error instanceof DemoGoldError ? error.message : error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Solo corre como script; si un test lo importa, no toca la base.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
