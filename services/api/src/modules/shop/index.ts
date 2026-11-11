/**
 * Módulo de tienda — dueño: Angel Arenales.
 *
 *   GET  /spells                      -> 200 SpellsResponse          (público)
 *   GET  /me/inventory                -> 200 InventoryResponse       (requireAuth)
 *   POST /shop/purchase               -> 200 PurchaseResponse        (requireAuth; compra atómica)
 *   PUT  /me/grimoire                 -> 200 UpdateGrimoireResponse  (requireAuth)
 *   GET  /internal/users/:id/loadout  -> 200 LoadoutResponse         (requireInternalKey)
 *
 * Errores (ApiErrorBody): SPELL_NOT_FOUND 404, ALREADY_OWNED 409, INSUFFICIENT_GOLD 409,
 * INVALID_GRIMOIRE 400 (con `details` por espacio), UNAUTHORIZED 401, FORBIDDEN 403, NOT_FOUND 404.
 */
import { Router } from "express";
import type {
  InventoryResponse,
  LoadoutResponse,
  PurchaseResponse,
  SpellsResponse,
  UpdateGrimoireResponse,
} from "@duelo/contracts";
import type { AppDeps } from "../../app-deps.js";
import { notFound } from "../../lib/http-error.js";
import { parseOrThrow } from "../../lib/validate.js";
import { getAuth, requireAuth } from "../../middleware/require-auth.js";
import { requireInternalKey } from "../../middleware/require-internal-key.js";
import { grimoireSchema, loadoutParamsSchema, purchaseSchema } from "./shop.schemas.js";
import { ShopService } from "./shop.service.js";

export function createShopRouter({ env, prisma }: AppDeps): Router {
  const router = Router();
  const service = new ShopService(prisma);
  const auth = requireAuth(env.JWT_SECRET);

  // Va primero porque Johan lo necesita para el game-server.
  router.get("/internal/users/:id/loadout", requireInternalKey(env.INTERNAL_API_KEY), async (req, res) => {
    const params = loadoutParamsSchema.safeParse(req.params);
    if (!params.success) {
      throw notFound(`No existe el usuario ${req.params.id}`);
    }
    const body: LoadoutResponse = await service.getLoadout(params.data.id);
    res.json(body);
  });

  router.get("/spells", async (_req, res) => {
    const body: SpellsResponse = await service.listSpells();
    res.json(body);
  });

  router.get("/me/inventory", auth, async (req, res) => {
    const body: InventoryResponse = await service.getInventory(getAuth(req).userId);
    res.json(body);
  });

  router.post("/shop/purchase", auth, async (req, res) => {
    const input = parseOrThrow(purchaseSchema, req.body);
    const body: PurchaseResponse = await service.purchase(getAuth(req).userId, input.spellId);
    res.json(body);
  });

  router.put("/me/grimoire", auth, async (req, res) => {
    const input = parseOrThrow(grimoireSchema, req.body);
    const body: UpdateGrimoireResponse = await service.updateGrimoire(getAuth(req).userId, input);
    res.json(body);
  });

  return router;
}
