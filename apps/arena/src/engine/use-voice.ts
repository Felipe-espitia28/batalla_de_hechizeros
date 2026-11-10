/**
 * Voz de los definitivos en la Arena. Pide el micrófono al entrar a la partida (en la calibración,
 * para no interrumpir el combate con el permiso) y lo libera al salir.
 * Micrófono denegado o navegador sin Web Speech: solo se desactivan los definitivos (sección 11).
 */
import type { UltimateId } from "@duelo/contracts";
import { VoiceListener, type UltimateEvent } from "@duelo/spell-engine";
import { useEffect, useRef, useState, type RefObject } from "react";

export type VoiceStatus = "off" | "loading" | "ready" | "disabled";

export interface VoiceState {
  status: VoiceStatus;
  /** Por qué están desactivados los definitivos (mensaje listo para mostrar). */
  message: string | null;
}

interface Options {
  enabled: boolean;
  ultimateId: UltimateId;
  onUltimate: (event: UltimateEvent) => void;
  /** Barra del medidor: se actualiza directo en el DOM, sin re-renderizar React 20 veces por segundo. */
  meter: RefObject<HTMLElement | null>;
}

export function useVoice({ enabled, ultimateId, onUltimate, meter }: Options): VoiceState {
  const [state, setState] = useState<VoiceState>({ status: "off", message: null });
  const listenerRef = useRef<VoiceListener | null>(null);
  const onUltimateRef = useRef(onUltimate);
  onUltimateRef.current = onUltimate;

  useEffect(() => {
    if (!enabled) return;
    const listener = new VoiceListener(
      {
        ultimateId,
        onLevel(level, isShout) {
          const el = meter.current;
          if (!el) return;
          // Escala no lineal: la voz normal (≈0,05) ya se ve, el grito llena la barra.
          el.style.setProperty("--level", String(Math.min(1, Math.sqrt(level / 0.2))));
          el.dataset.shout = String(isShout);
        },
      },
      {
        onUltimate: (e) => onUltimateRef.current(e),
        onError: (e) => setState({ status: "disabled", message: e.message }),
      },
    );
    listenerRef.current = listener;
    setState({ status: "loading", message: null });
    let cancelled = false;
    void listener.start().then((ok) => {
      if (!cancelled && ok) setState({ status: "ready", message: null });
    });
    return () => {
      cancelled = true;
      listener.stop();
      listenerRef.current = null;
      setState({ status: "off", message: null });
    };
    // ultimateId se actualiza con setUltimate (efecto de abajo) sin volver a pedir el micrófono.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    listenerRef.current?.setUltimate(ultimateId);
  }, [ultimateId]);

  return state;
}
