/**
 * Icono de un hechizo o definitivo con los SVG del diseño de Figma ("Tienda · Grimorio").
 * Cada SVG trae su propio tamaño (22 px los hechizos, 24 px los definitivos) y se respeta.
 * Corte, Bola de fuego, Curación y Sello de silencio no tienen icono en el diseño: se usa su
 * emoji de game-rules en una caja del mismo tamaño.
 */
import type { AnySpellId } from "@duelo/contracts";
import { UI_ASSETS_PATH } from "./config";
import { getDefinition } from "./shop-logic";

const ICONS: Partial<Record<AnySpellId, { file: string; size: number }>> = {
  lightning: { file: "rayo.svg", size: 22 },
  shield: { file: "escudo.svg", size: 22 },
  freeze: { file: "congelar.svg", size: 22 },
  poison: { file: "veneno.svg", size: 22 },
  meteor: { file: "meteoro.svg", size: 24 },
  storm: { file: "tormenta.svg", size: 24 },
  rebirth: { file: "renacer.svg", size: 24 },
  "purple-void": { file: "vacio-purpura.svg", size: 24 },
};

export function SpellIcon({ id, className = "" }: { id: AnySpellId; className?: string }) {
  const icon = ICONS[id];
  if (icon) {
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
  // Sin icono en el diseño: emoji del catálogo, en la caja de un hechizo (22 px).
  return (
    <span className={`t-icon t-icon--emoji ${className}`} aria-hidden="true">
      {getDefinition(id).emoji}
    </span>
  );
}

/** Iconos del catálogo (Figma "Tienda · Catálogo completo"): uno por hechizo, todos de 26 px. */
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

export function CatalogIcon({ id }: { id: AnySpellId }) {
  return (
    <img className="t-icon" src={`${UI_ASSETS_PATH}/catalogo/${CATALOG_ICONS[id]}`} width={26} height={26} alt="" aria-hidden="true" />
  );
}

/** Otros iconos del diseño, a su tamaño original. */
export function UiIcon({ name, size, className = "" }: { name: "moneda" | "desplegar" | "radio-on" | "radio-off"; size: number; className?: string }) {
  return <img className={className} src={`${UI_ASSETS_PATH}/${name}.svg`} width={size} height={size} alt="" aria-hidden="true" />;
}
