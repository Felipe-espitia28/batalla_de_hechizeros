/**
 * Conecta el módulo local (spell-engine) con React. Crea el motor de cámara o, en desarrollo
 * con ?teclado, el modo teclado. Libera la cámara al desmontar (al salir de la Arena).
 */
import type { SpellId } from "@duelo/contracts";
import {
  KeyboardSpellSource,
  SpellEngine,
  drawDebug,
  drawStroke,
  type SpellEngineError,
  type SpellEngineHandlers,
  type SpellSource,
} from "@duelo/spell-engine";
import { useEffect, useRef, useState, type RefObject } from "react";
import { MEDIAPIPE_MODEL_PATH, MEDIAPIPE_WASM_PATH, keyboardModeEnabled } from "../config";

export type EngineStatus = "off" | "loading" | "running" | "error";

export interface SpellSourceState {
  status: EngineStatus;
  error: SpellEngineError | null;
  keyboard: boolean;
  /** true si se ve al menos una mano (para la calibración). */
  handVisible: boolean;
}

interface Options {
  enabled: boolean;
  grimoire: readonly SpellId[];
  /** Mostrar esqueleto de la mano (modo depuración). */
  debug: boolean;
  handlers: SpellEngineHandlers;
  video: RefObject<HTMLVideoElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  /** Cambiarlo reinicia la cámara (botón "Reintentar" tras un error). */
  attempt?: number;
}

export function useSpellSource({ enabled, grimoire, debug, handlers, video, canvas, attempt = 0 }: Options): SpellSourceState {
  const keyboard = keyboardModeEnabled();
  const [status, setStatus] = useState<EngineStatus>("off");
  const [error, setError] = useState<SpellEngineError | null>(null);
  const [handVisible, setHandVisible] = useState(false);
  const sourceRef = useRef<SpellSource | null>(null);

  // Los handlers cambian en cada render; el motor guarda una referencia estable que los lee aquí.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const debugRef = useRef(debug);
  debugRef.current = debug;

  useEffect(() => {
    if (!enabled) return;
    const stable: SpellEngineHandlers = {
      onSpell: (e) => handlersRef.current.onSpell?.(e),
      onSpellFailed: (e) => handlersRef.current.onSpellFailed?.(e),
      onError: (e) => {
        setError(e);
        setStatus("error");
        handlersRef.current.onError?.(e);
      },
    };

    let source: SpellSource;
    if (keyboard) {
      source = new KeyboardSpellSource(grimoire, stable);
    } else {
      const videoEl = video.current;
      if (!videoEl) return;
      let lastHandVisible = false;
      source = new SpellEngine(
        {
          video: videoEl,
          wasmBasePath: MEDIAPIPE_WASM_PATH,
          modelAssetPath: MEDIAPIPE_MODEL_PATH,
          grimoire,
          onFrame(snapshot, size) {
            const visible = snapshot.hands.length > 0;
            // Solo re-renderiza React cuando cambia, no 30 veces por segundo.
            if (visible !== lastHandVisible) {
              lastHandVisible = visible;
              setHandVisible(visible);
            }
            const c = canvas.current;
            const ctx = c?.getContext("2d");
            if (!c || !ctx) return;
            if (c.width !== size.width || c.height !== size.height) {
              c.width = size.width;
              c.height = size.height;
            }
            ctx.clearRect(0, 0, c.width, c.height);
            if (debugRef.current) drawDebug(ctx, snapshot);
            drawStroke(ctx, snapshot.stroke);
          },
        },
        stable,
      );
    }

    sourceRef.current = source;
    setError(null);
    setStatus("loading");
    let cancelled = false;
    void source.start().then((ok) => {
      if (!cancelled && ok) setStatus("running");
    });

    return () => {
      cancelled = true;
      source.stop();
      sourceRef.current = null;
      setStatus("off");
      setHandVisible(false);
    };
    // El grimorio se actualiza con setGrimoire (efecto de abajo) sin reiniciar la cámara.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, keyboard, attempt]);

  useEffect(() => {
    sourceRef.current?.setGrimoire(grimoire);
  }, [grimoire]);

  return { status, error, keyboard, handVisible: keyboard || handVisible };
}
