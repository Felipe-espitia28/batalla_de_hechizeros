/**
 * Interruptor "Agente local | Cámara del navegador" bajo el espacio de la cámara.
 *
 * Por qué: el agente local (R2) es el modo por defecto, y "Usar la cámara del navegador" es el
 * respaldo. Sin esto, una vez elegido el navegador no había forma de volver al agente sin abrir
 * otra pestaña. Se muestra en el entrenamiento y en la calibración, no durante el combate: cambiar
 * de fuente reinicia la cámara.
 */
import type { SpellSourceMode } from "../config";

interface Props {
  mode: SpellSourceMode;
  onUseAgent: () => void;
  onUseBrowserCamera: () => void;
}

export function SourceSwitch({ mode, onUseAgent, onUseBrowserCamera }: Props) {
  return (
    <div className="ar-source" role="group" aria-label="De dónde salen tus hechizos">
      <span className="ar-source__label">Cámara:</span>
      <button
        type="button"
        className="ar-source__option"
        aria-pressed={mode === "agent"}
        onClick={mode === "agent" ? undefined : onUseAgent}
      >
        Agente local
      </button>
      <button
        type="button"
        className="ar-source__option"
        aria-pressed={mode === "browser"}
        onClick={mode === "browser" ? undefined : onUseBrowserCamera}
      >
        Navegador
      </button>
    </div>
  );
}
