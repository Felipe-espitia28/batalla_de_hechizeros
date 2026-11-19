/**
 * Panel PROVISIONAL del agente local, en el lugar de la cámara.
 *
 * El diseño final es de Angel (apps/arena/src/ui/agent-panel.tsx, rama feat/agente-local-ui).
 * Este archivo tiene exactamente sus props (docs/prompts-agente-local.md) y otro nombre a
 * propósito, para que los dos PRs no choquen: cuando entre el de Angel, basta con cambiar el
 * import en App.tsx y practice-view.tsx y borrar este archivo.
 */
import type { SpellId } from "@duelo/contracts";
import { SPELLS } from "@duelo/game-rules";
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

export function AgentPanel({ state, handVisible, lastSpell, errorMessage, onRetry, onUseBrowserCamera }: AgentPanelProps) {
  return (
    <div className={`ar-agentp ar-agentp--${state}`}>
      {state === "connecting" && <p role="status">Buscando el agente local…</p>}

      {state === "connected" && (
        <>
          <p role="status" className="ar-agentp__title">
            🖥️ Agente local conectado
          </p>
          <p>{handVisible ? "✅ Mano detectada" : "✋ Pon la mano frente a la cámara del agente"}</p>
          {lastSpell && (
            <p className="ar-agentp__last">
              <SpellGlyph id={lastSpell.spellId} /> {SPELLS[lastSpell.spellId].name} · {Math.round(lastSpell.confidence * 100)} %
            </p>
          )}
          <p className="ar-agentp__note">Dibuja en la ventana del agente: aquí solo llegan los eventos.</p>
        </>
      )}

      {state === "detector-closed" && (
        <>
          <p role="status" className="ar-agentp__title">
            La ventana del detector está cerrada
          </p>
          <p>El agente sigue abierto, pero sin su ventana no hay cámara. Vuelve a abrirla o reinicia el agente.</p>
        </>
      )}

      {state === "not-found" && (
        <>
          <p role="status" className="ar-agentp__title">
            No encontramos el agente local
          </p>
          <ol className="ar-agentp__steps">
            <li>
              Abre una terminal en el proyecto y ejecuta <code>corepack pnpm --filter @duelo/local-agent start</code>.
            </li>
            <li>Deja abierta la ventana del detector que se abre.</li>
          </ol>
          <div className="ar-agentp__actions">
            <button type="button" className="ar-btn ar-btn--primary" onClick={onRetry}>
              Reintentar
            </button>
            <button type="button" className="ar-btn" onClick={onUseBrowserCamera}>
              Usar la cámara del navegador
            </button>
          </div>
        </>
      )}

      {state === "camera-error" && (
        <>
          <p role="status" className="ar-agentp__title">
            {errorMessage ?? "Error en la cámara del agente"}
          </p>
          <div className="ar-agentp__actions">
            <button type="button" className="ar-btn ar-btn--primary" onClick={onRetry}>
              Reintentar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
