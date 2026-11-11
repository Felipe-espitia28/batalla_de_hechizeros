/**
 * Lógica de la tienda: catálogo, inventario, compra, grimorio y loadout interno.
 * Las rutas solo validan la forma y llaman aquí.
 */
import type {
  AnySpellId,
  Grimoire,
  InventoryResponse,
  LoadoutResponse,
  PurchaseResponse,
  SpellCatalogItem,
  SpellsResponse,
} from "@duelo/contracts";
import { getRankForRating } from "@duelo/game-rules";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpError, notFound, unauthorized } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { buildGrimoire, findGrimoireProblems, grimoireSpells, type GrimoireInput } from "./grimoire.js";

/** Se lanza dentro de la transacción para deshacerla; fuera se convierte en HttpError. */
class InsufficientGoldError extends Error {}

export class ShopService {
  constructor(private readonly prisma: PrismaClient) {}

  /** GET /spells: desde la tabla `spells`, que el seed llena desde game-rules. */
  async listSpells(): Promise<SpellsResponse> {
    const spells = await this.prisma.spell.findMany({ orderBy: { sortOrder: "asc" } });
    return {
      spells: spells.map(
        (spell): SpellCatalogItem => ({
          id: spell.id as AnySpellId,
          name: spell.name,
          kind: spell.kind,
          gestureDescription: spell.gestureDescription,
          price: spell.price,
          isStarter: spell.isStarter,
          sortOrder: spell.sortOrder,
        }),
      ),
    };
  }

  /** GET /me/inventory */
  async getInventory(userId: string): Promise<InventoryResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        equippedUltimateId: true,
        spells: { orderBy: { acquiredAt: "asc" } },
        grimoireSlots: true,
      },
    });
    if (!user) {
      // Token válido de una cuenta que ya no existe: la Tienda debe volver al login (401).
      throw unauthorized("La cuenta ya no existe");
    }
    return {
      items: user.spells.map((item) => ({
        spellId: item.spellId as AnySpellId,
        pricePaid: item.pricePaid,
        acquiredAt: item.acquiredAt.toISOString(),
      })),
      grimoire: buildGrimoire(user.grimoireSlots, user.equippedUltimateId),
    };
  }

  /**
   * POST /shop/purchase — compra atómica (sección 8 de CLAUDE.md).
   *
   * Todo ocurre en una transacción:
   *   1. Insertar en `user_spells`. La PK (user_id, spell_id) hace que de dos clics simultáneos
   *      solo uno pueda insertar: el otro espera el bloqueo del índice y luego falla con P2002.
   *   2. Descontar el oro con la condición `gold >= precio` en el mismo UPDATE. Postgres vuelve a
   *      evaluar la condición sobre la fila ya bloqueada, así que dos compras de hechizos distintos
   *      tampoco pueden dejar oro negativo (y el CHECK gold >= 0 de la migración es la última red).
   * Si cualquiera de los dos pasos falla, se deshace todo: ni oro perdido ni hechizo regalado.
   */
  async purchase(userId: string, spellId: string): Promise<PurchaseResponse> {
    const spell = await this.prisma.spell.findUnique({ where: { id: spellId } });
    if (!spell) {
      throw new HttpError(404, "SPELL_NOT_FOUND", `No existe el hechizo "${spellId}"`);
    }

    try {
      const gold = await this.prisma.$transaction(async (tx) => {
        await tx.userSpell.create({ data: { userId, spellId: spell.id, pricePaid: spell.price } });
        const charged = await tx.user.updateMany({
          where: { id: userId, gold: { gte: spell.price } },
          data: { gold: { decrement: spell.price } },
        });
        if (charged.count === 0) {
          throw new InsufficientGoldError();
        }
        const updated = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { gold: true } });
        return updated.gold;
      });
      return { spellId: spell.id as AnySpellId, gold };
    } catch (error) {
      if (error instanceof InsufficientGoldError) {
        const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { gold: true } });
        if (!user) throw unauthorized("La cuenta ya no existe");
        throw new HttpError(
          409,
          "INSUFFICIENT_GOLD",
          `Te faltan ${spell.price - user.gold} de oro para comprar ${spell.name}`,
          { gold: user.gold, price: spell.price },
        );
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // P2002: ya estaba en el inventario (incluye el segundo de dos clics simultáneos).
        if (error.code === "P2002") {
          throw new HttpError(409, "ALREADY_OWNED", `Ya tienes ${spell.name}`);
        }
        // P2003: la FK a users falló, o sea que la cuenta del token ya no existe.
        if (error.code === "P2003") {
          throw unauthorized("La cuenta ya no existe");
        }
      }
      throw error;
    }
  }

  /** PUT /me/grimoire: valida contra el inventario y reemplaza los espacios en una transacción. */
  async updateGrimoire(userId: string, input: GrimoireInput): Promise<Grimoire> {
    const owned = await this.prisma.userSpell.findMany({ where: { userId }, select: { spellId: true } });
    const problems = findGrimoireProblems(input, new Set(owned.map((item) => item.spellId)));
    if (problems.length > 0) {
      throw new HttpError(400, "INVALID_GRIMOIRE", problems[0]?.message ?? "Grimorio inválido", problems);
    }

    // Ya validado: los espacios tienen la forma del contrato.
    const grimoire = buildGrimoire(
      input.slots.flatMap((spellId, index) => (spellId === null ? [] : [{ slot: index + 1, spellId }])),
      input.ultimateId,
    );

    try {
      await this.prisma.$transaction([
        // Borrar y volver a crear es más simple que comparar espacio por espacio, y evita chocar con
        // el UNIQUE (user_id, spell_id) al mover un hechizo del espacio 3 al 4.
        this.prisma.grimoireSlot.deleteMany({ where: { userId } }),
        this.prisma.grimoireSlot.createMany({
          data: grimoire.slots.flatMap((spellId, index) =>
            spellId === null ? [] : [{ userId, slot: index + 1, spellId }],
          ),
        }),
        this.prisma.user.update({ where: { id: userId }, data: { equippedUltimateId: grimoire.ultimateId } }),
      ]);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2025" || error.code === "P2003")
      ) {
        throw unauthorized("La cuenta ya no existe");
      }
      throw error;
    }
    return grimoire;
  }

  /** GET /internal/users/:id/loadout — lo consulta el game-server al entrar a la cola. */
  async getLoadout(userId: string): Promise<LoadoutResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, rating: true, equippedUltimateId: true, grimoireSlots: true },
    });
    if (!user) {
      // El game-server distingue 404 (UnknownUserError) de cualquier otro fallo.
      throw notFound(`No existe el usuario ${userId}`);
    }
    const grimoire = buildGrimoire(user.grimoireSlots, user.equippedUltimateId);
    return {
      userId: user.id,
      username: user.username,
      rating: user.rating,
      rank: getRankForRating(user.rating),
      spells: grimoireSpells(grimoire),
      ultimateId: grimoire.ultimateId,
    };
  }
}
