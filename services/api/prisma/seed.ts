/**
 * Seed del catálogo — dueño: Angel Arenales.
 *
 * Llena la tabla `spells` con SPELL_CATALOG de @duelo/game-rules (8 hechizos y 4 definitivos).
 * El catálogo vive en el código y no en la base (sección 4 de CLAUDE.md): así un cambio de precio
 * se hace con un PR revisado y la base nunca queda con números distintos a los del game-server.
 *
 * Es idempotente (upsert): se puede correr en cada despliegue. Si cambia un precio en game-rules,
 * volver a correrlo actualiza la fila; lo ya comprado conserva su `price_paid` original.
 * No borra filas: un hechizo con compradores no se puede eliminar sin romper las FK de inventario.
 *
 * Uso: pnpm --filter @duelo/api db:seed
 */
import { SPELL_CATALOG } from "@duelo/game-rules";
import { createPrismaClient } from "../src/lib/prisma.js";

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    // Una sola transacción: o queda el catálogo completo o no cambia nada.
    await prisma.$transaction(
      SPELL_CATALOG.map((spell) =>
        prisma.spell.upsert({ where: { id: spell.id }, create: { ...spell }, update: { ...spell } }),
      ),
    );
    const starters = SPELL_CATALOG.filter((spell) => spell.isStarter).length;
    console.log(`Seed listo: ${SPELL_CATALOG.length} hechizos en el catálogo (${starters} iniciales).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
