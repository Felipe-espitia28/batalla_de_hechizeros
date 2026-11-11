/**
 * Definitivo equipado: cómo activarlo y un medidor de volumen para que el jugador sepa
 * cuándo su grito supera el umbral. Lo de "maná lleno" es solo una pista visual: quien
 * decide si se puede lanzar es el servidor.
 */
import type { UltimateId } from "@duelo/contracts";
import { ULTIMATES } from "@duelo/game-rules";
import type { RefObject } from "react";
import { SPELL_LABELS } from "../match/messages";
import type { VoiceState } from "../engine/use-voice";

interface Props {
  ultimateId: UltimateId;
  voice: VoiceState;
  keyboard: boolean;
  manaFull: boolean;
  meter: RefObject<HTMLDivElement | null>;
}

export function UltimateRow({ ultimateId, voice, keyboard, manaFull, meter }: Props) {
  const word = ULTIMATES[ultimateId].acceptedWords[0] ?? "";
  const hint = keyboard ? "tecla 9" : `grita «¡${word}!»`;

  return (
    <div className={`ar-ultimate${manaFull ? " ar-ultimate--ready" : ""}`}>
      <div className="ar-ultimate__head">
        <span>{SPELL_LABELS[ultimateId]}</span>
        <span className="ar-muted">{manaFull ? `¡Maná lleno! ${hint}` : `${hint} con el maná lleno`}</span>
      </div>
      {!keyboard && voice.status === "disabled" && <p className="ar-ultimate__off">{voice.message}</p>}
      {!keyboard && voice.status !== "disabled" && (
        <div className="ar-meter" ref={meter} aria-hidden>
          <div className="ar-meter__fill" />
        </div>
      )}
    </div>
  );
}
