/**
 * Panel del agente local en el lugar de la cámara de la Arena (unos 442×332 px).
 *
 * Con el agente, la cámara se abre en la ventana del detector, en el PC del jugador (R2): aquí solo
 * se muestra en qué estado está y el último hechizo que llegó como evento. Es solo presentación:
 * los datos y las acciones los conecta Juan desde use-spell-source.ts.
 */
import type { SpellId } from "@duelo/contracts";
import { SPELLS } from "@duelo/game-rules";
import { useId } from "react";
import { LOCAL_AGENT_DOWNLOAD_URL } from "../config";
import { SpellGlyph } from "./spell-glyph";

export type AgentPanelState = "connecting" | "connected" | "detector-closed" | "not-found" | "camera-error";

export interface AgentPanelProps {
  state: AgentPanelState;
  handVisible: boolean;
  lastSpell: { spellId: SpellId; confidence: number } | null;
  errorMessage: string | null;
  onRetry: () => void;
  onUseBrowserCamera: () => void;
}

const START_COMMAND = "corepack pnpm --filter @duelo/local-agent start";

export function AgentPanel({ state, handVisible, lastSpell, errorMessage, onRetry, onUseBrowserCamera }: AgentPanelProps) {
  // Id único: el panel puede aparecer en la Arena y en el entrenamiento.
  const titleId = useId();
  return (
    <section className={`ar-agent ar-agent--${state}`} aria-labelledby={titleId}>
      {state === "connecting" && (
        <div className="ar-agent__body">
          <span className="ar-agent__spinner" aria-hidden="true" />
          <p id={titleId} className="ar-agent__title" role="status">
            Buscando el agente local…
          </p>
          <p className="ar-agent__text">Si ya lo abriste, tarda un momento en responder.</p>
        </div>
      )}

      {state === "connected" && (
        <div className="ar-agent__body">
          <p className="ar-agent__badge">
            <span className="ar-agent__dot" aria-hidden="true" /> En línea
          </p>
          <p id={titleId} className="ar-agent__title" role="status">
            Agente local conectado
          </p>
          <p className={`ar-agent__hand ar-agent__hand--${handVisible ? "on" : "off"}`}>
            {handVisible ? "Mano detectada en la ventana del agente" : "Pon la mano frente a la cámara del agente"}
          </p>
          {/* Fuera del role="status": con cada hechizo cambiaría y el lector leería todo de nuevo. */}
          {lastSpell ? (
            <div className="ar-agent__last">
              <span className="ar-agent__last-label">Último hechizo</span>
              <span className="ar-agent__spell">
                <SpellGlyph id={lastSpell.spellId} size={22} />
                {SPELLS[lastSpell.spellId].name}
                <span className="ar-agent__confidence">{Math.round(lastSpell.confidence * 100)} %</span>
              </span>
            </div>
          ) : (
            <p className="ar-agent__text">Haz la pinza y dibuja un gesto en la ventana del agente.</p>
          )}
          <p className="ar-agent__note">A la Arena solo llegan eventos: el video no sale de tu PC.</p>
        </div>
      )}

      {state === "detector-closed" && (
        <div className="ar-agent__body">
          <p id={titleId} className="ar-agent__title" role="status">
            La ventana del detector está cerrada
          </p>
          <p className="ar-agent__text">
            El agente sigue abierto, pero la cámara vive en su ventana. Vuelve a abrirla desde el agente o
            reinícialo (ciérralo y ábrelo otra vez).
          </p>
        </div>
      )}

      {state === "not-found" && (
        <div className="ar-agent__body ar-agent__body--start">
          <p id={titleId} className="ar-agent__title" role="status">
            No encontramos el agente local
          </p>
          <ol className="ar-agent__steps">
            <li>
              En una terminal, en la carpeta del proyecto: <code>{START_COMMAND}</code>
            </li>
            <li>Deja abierta la ventana del detector que se abre.</li>
            <li>Vuelve aquí y pulsa «Reintentar».</li>
          </ol>
          <div className="ar-agent__actions">
            <button type="button" className="ar-agent__btn ar-agent__btn--primary" onClick={onRetry}>
              Reintentar
            </button>
            <button type="button" className="ar-agent__btn" onClick={onUseBrowserCamera}>
              Usar la cámara del navegador
            </button>
          </div>
          {/* Para quien no tiene el repositorio: el ZIP de GitHub Releases, si la Arena lo tiene configurado. */}
          {LOCAL_AGENT_DOWNLOAD_URL && (
            <a className="ar-agent__link" href={LOCAL_AGENT_DOWNLOAD_URL} target="_blank" rel="noreferrer">
              Descargar el agente
            </a>
          )}
        </div>
      )}

      {state === "camera-error" && (
        <div className="ar-agent__body">
          <p id={titleId} className="ar-agent__title" role="status">
            {errorMessage ?? "La cámara del agente no está disponible"}
          </p>
          <p className="ar-agent__text">Revisa el permiso de la cámara en la ventana del agente y que ningún otro programa la use.</p>
          <div className="ar-agent__actions">
            <button type="button" className="ar-agent__btn ar-agent__btn--primary" onClick={onRetry}>
              Reintentar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
