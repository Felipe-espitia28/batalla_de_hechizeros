/**
 * Catálogo en la forma de `GET /spells` y de la tabla `spells`.
 * El seed del api lo inserta tal cual, así la base nunca tiene precios distintos a los del código.
 */
import type { SpellCatalogItem } from "@duelo/contracts";
import { SPELLS, ULTIMATES, type SpellDefinition, type UltimateDefinition } from "./spells.js";

function toCatalogItem(def: SpellDefinition | UltimateDefinition): SpellCatalogItem {
  return {
    id: def.id,
    name: def.name,
    kind: def.kind,
    gestureDescription: def.gestureDescription,
    price: def.price,
    isStarter: def.isStarter,
    sortOrder: def.sortOrder,
  };
}

/** Hechizos y definitivos ordenados por `sortOrder`. */
export const SPELL_CATALOG: readonly SpellCatalogItem[] = [
  ...Object.values(SPELLS),
  ...Object.values(ULTIMATES),
]
  .map(toCatalogItem)
  .sort((a, b) => a.sortOrder - b.sortOrder);
