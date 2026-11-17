/**
 * Iconos de los hechizos con los SVG del diseño de Figma. Cada SVG trae su propio tamaño y se respeta:
 * - "Tienda · Grimorio": 22 px los hechizos y 24 px los definitivos (8 iconos);
 * - "Tienda · Catálogo completo": 26 px, uno por hechizo (12 iconos).
 */
import type { AnySpellId } from "@duelo/contracts";
import { UI_ASSETS_PATH } from "./config";

/** Iconos del catálogo: uno por hechizo, todos de 26 px. */
const CATALOG_ICONS: Record<AnySpellId, string> = {
  lightning: "rayo.svg",
  shield: "escudo.svg",
  slash: "corte.svg",
  fireball: "bola-de-fuego.svg",
  heal: "curacion.svg",
  poison: "veneno.svg",
  freeze: "congelar.svg",
  "silence-seal": "sello-de-silencio.svg",
  meteor: "meteoro.svg",
  storm: "tormenta.svg",
  rebirth: "renacer.svg",
  "purple-void": "vacio-purpura.svg",
};

/** Iconos del grimorio. Corte, Bola de fuego, Curación y Sello no están en ese frame. */
const GRIMOIRE_ICONS: Partial<Record<AnySpellId, { file: string; size: number }>> = {
  lightning: { file: "rayo.svg", size: 22 },
  shield: { file: "escudo.svg", size: 22 },
  freeze: { file: "congelar.svg", size: 22 },
  poison: { file: "veneno.svg", size: 22 },
  meteor: { file: "meteoro.svg", size: 24 },
  storm: { file: "tormenta.svg", size: 24 },
  rebirth: { file: "renacer.svg", size: 24 },
  "purple-void": { file: "vacio-purpura.svg", size: 24 },
};

/**
 * Icono del grimorio. Si el frame del grimorio no lo dibujó, se usa el del catálogo (26 px):
 * así ningún hechizo cae al emoji.
 */
export function SpellIcon({ id, className = "" }: { id: AnySpellId; className?: string }) {
  const icon = GRIMOIRE_ICONS[id];
  if (!icon) return <CatalogIcon id={id} className={className} />;
  return (
    <img
      className={`t-icon ${className}`}
      src={`${UI_ASSETS_PATH}/${icon.file}`}
      width={icon.size}
      height={icon.size}
      alt=""
      aria-hidden="true"
    />
  );
}

export function CatalogIcon({ id, className = "" }: { id: AnySpellId; className?: string }) {
  return (
    <img
      className={`t-icon ${className}`}
      src={`${UI_ASSETS_PATH}/catalogo/${CATALOG_ICONS[id]}`}
      width={26}
      height={26}
      alt=""
      aria-hidden="true"
    />
  );
}

/** Otros iconos del diseño, a su tamaño original. */
export function UiIcon({ name, size, className = "" }: { name: "moneda" | "desplegar" | "radio-on" | "radio-off"; size: number; className?: string }) {
  return <img className={className} src={`${UI_ASSETS_PATH}/${name}.svg`} width={size} height={size} alt="" aria-hidden="true" />;
}
