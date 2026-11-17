/**
 * Tarjeta ilustrada de un gesto en el lobby (Figma "Gesto de rayo" / "Gesto de escudo"):
 * la guía circular punteada, el trazo y el punto donde empieza el gesto, con su etiqueta.
 * Las posiciones son las del diseño dentro de un área de 168 × 160 px.
 */
import { UI_ASSETS_PATH } from "../config";

export interface GestureArt {
  /** Archivo del trazo en public/ui. */
  stroke: string;
  /** Posición y tamaño del contenedor del trazo dentro del área de 168 × 160. */
  strokeBox: { left: number; top: number; width: number; height: number };
  /** Archivo del punto de inicio en public/ui. */
  start: string;
  startPos: { left: number; top: number };
}

interface Props {
  art: GestureArt;
  label: string;
  tone: "gold" | "violet";
}

export function GestureCard({ art, label, tone }: Props) {
  return (
    <figure className="ar-gesture">
      <div className="ar-gesture__art" aria-hidden>
        <img className="ar-gesture__guide" src={`${UI_ASSETS_PATH}/guia-circular.png`} width={144} height={144} alt="" />
        <img className="ar-gesture__stroke" src={`${UI_ASSETS_PATH}/${art.stroke}`} style={art.strokeBox} alt="" />
        <img className="ar-gesture__start" src={`${UI_ASSETS_PATH}/${art.start}`} style={art.startPos} width={9} height={9} alt="" />
      </div>
      <figcaption className={`ar-gesture__label ar-gesture__label--${tone}`}>{label}</figcaption>
    </figure>
  );
}

/** Zigzag del Rayo: el contenedor de 41 × 100 en (63, 30) lleva un margen de -2,5 % / -6,1 % (el SVG mide 46 × 105). */
export const LIGHTNING_ART: GestureArt = {
  stroke: "gesto-zigzag.svg",
  strokeBox: { left: 63 - 2.5, top: 30 - 2.5, width: 46, height: 105 },
  start: "inicio-zigzag.svg",
  startPos: { left: 94.5, top: 25.5 },
};

/** Círculo del Escudo: 86 × 86 en (41, 37). */
export const SHIELD_ART: GestureArt = {
  stroke: "gesto-circulo.svg",
  strokeBox: { left: 41, top: 37, width: 86, height: 86 },
  start: "inicio-circulo.svg",
  startPos: { left: 79.5, top: 32.5 },
};
