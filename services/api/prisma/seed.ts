/**
 * Seed mínimo: solo los 3 hechizos iniciales que el registro entrega (Rayo, Escudo y Meteoro).
 * Sin ellos falla la FK de user_spells y no se puede crear ninguna cuenta (login es P0).
 *
 * TODO(Angel): reemplazar por el seed completo del catálogo generado desde @duelo/game-rules.
 * Es idempotente (upsert), así que se puede correr cuantas veces haga falta.
 */
import "dotenv/config";
import { createPrismaClient } from "../src/lib/prisma.js";

const STARTER_SPELLS = [
  {
    id: "lightning",
    name: "Rayo",
    kind: "spell",
    gestureDescription: "Zigzag de izquierda a derecha",
    price: 0,
    isStarter: true,
    sortOrder: 1,
  },
  {
    id: "shield",
    name: "Escudo",
    kind: "spell",
    gestureDescription: "Círculo",
    price: 0,
    isStarter: true,
    sortOrder: 2,
  },
  {
    id: "meteor",
    name: "Meteoro",
    kind: "ultimate",
    gestureDescription: "Gritar «meteoro» con el maná lleno",
    price: 0,
    isStarter: true,
    sortOrder: 100,
  },
] as const;

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    for (const spell of STARTER_SPELLS) {
      await prisma.spell.upsert({ where: { id: spell.id }, create: spell, update: spell });
    }
    console.log(`Seed listo: ${STARTER_SPELLS.length} hechizos iniciales.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
