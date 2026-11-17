/**
 * Icono de 18 px de un hechizo, del diseño de Figma "Arena · Entrenamiento".
 * Ese frame dibuja Rayo, Escudo, Congelar, Veneno y Tormenta; los otros 7 usan el mismo dibujo del
 * catálogo de la Tienda (copiado en public/ui/entrenamiento) para que ningún hechizo caiga al emoji.
 * Se resuelve contra el origen de la Arena (UI_ASSETS_PATH): dentro del shell, "/ui/..." daría 404.
 */
import type { AnySpellId } from "@duelo/contracts";
import { UI_ASSETS_PATH } from "../config";

const FILES: Record<AnySpellId, string> = {
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

export function SpellGlyph({ id, size = 18 }: { id: AnySpellId; size?: number }) {
  return (
    <img
      className="ar-glyph"
      src={`${UI_ASSETS_PATH}/entrenamiento/${FILES[id]}`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}
