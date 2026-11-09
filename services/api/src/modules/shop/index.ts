/**
 * Módulo de tienda — dueño: Angel Arenales.
 *
 * Rutas que van aquí (sección 8 de CLAUDE.md; tipos en @duelo/contracts, rest.ts):
 *   GET  /spells                       -> SpellsResponse
 *   GET  /me/inventory                 -> InventoryResponse          (requireAuth)
 *   POST /shop/purchase                -> PurchaseResponse           (requireAuth; compra atómica)
 *   PUT  /me/grimoire                  -> UpdateGrimoireResponse     (requireAuth)
 *   GET  /internal/users/:id/loadout   -> LoadoutResponse            (requireInternalKey)
 *
 * Herramientas disponibles:
 *   - requireAuth(deps.env.JWT_SECRET) y getAuth(req)  -> ../../middleware/require-auth.js
 *   - requireInternalKey(deps.env.INTERNAL_API_KEY)    -> ../../middleware/require-internal-key.js
 *   - parseOrThrow(schema, req.body)                   -> ../../lib/validate.js
 *   - throw new HttpError(409, "INSUFFICIENT_GOLD", "…") -> ../../lib/http-error.js
 * Se pueden crear más archivos dentro de esta carpeta (shop.routes.ts, shop.service.ts…).
 */
import { Router } from "express";
import type { AppDeps } from "../../app-deps.js";

export function createShopRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
