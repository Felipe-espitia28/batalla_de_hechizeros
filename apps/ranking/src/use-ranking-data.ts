/**
 * Carga top, posición propia e historial, y los recarga cuando la Arena avisa que terminó
 * una partida (duelo:match-ended, sección 9).
 */
import {
  emitDueloEvent,
  onDueloEvent,
  type MatchHistoryItem,
  type RankingEntry,
  type RankingMeResponse,
  type Session,
} from "@duelo/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { RankingApiError, type RankingApi } from "./api";
import { SLOW_LOAD_MS } from "./config";

export interface RankingData {
  top: RankingEntry[];
  me: RankingMeResponse;
  history: MatchHistoryItem[];
}

export interface RankingState {
  data: RankingData | null;
  error: RankingApiError | null;
  /** Hay una carga en curso (la primera o una recarga con datos ya en pantalla). */
  loading: boolean;
  /** La carga tarda más de lo normal: probablemente Render o Neon están despertando. */
  slow: boolean;
}

export function useRankingData(api: RankingApi, session: Session) {
  const [state, setState] = useState<RankingState>({ data: null, error: null, loading: true, slow: false });
  // Si llegan dos recargas seguidas (p. ej. match-ended y el botón), solo cuenta la última.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setState((s) => ({ ...s, loading: true, slow: false, error: null }));
    const slowTimer = setTimeout(() => {
      if (id === requestId.current) setState((s) => ({ ...s, slow: true }));
    }, SLOW_LOAD_MS);

    try {
      const [top, me, history] = await Promise.all([
        api.top(),
        api.me(session.token),
        api.history(session.token),
      ]);
      if (id !== requestId.current) return;
      setState({ data: { top: top.entries, me, history: history.matches }, error: null, loading: false, slow: false });
    } catch (caught) {
      if (id !== requestId.current) return;
      const error =
        caught instanceof RankingApiError
          ? caught
          : new RankingApiError(0, "INTERNAL_ERROR", "Algo salió mal al cargar el ranking.");
      // 401: la sesión ya no sirve; el shell escucha este evento y lleva al login.
      if (error.isSessionExpired) emitDueloEvent("duelo:session-expired", {});
      // Se conservan los datos anteriores: un fallo al recargar no borra lo que ya se veía.
      setState((s) => ({ ...s, error, loading: false, slow: false }));
    } finally {
      clearTimeout(slowTimer);
    }
  }, [api, session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  // El api ya registró la partida antes de que la Arena reciba match:end, así que recargar trae los puntos nuevos.
  useEffect(() => onDueloEvent("duelo:match-ended", () => void load()), [load]);

  return { ...state, reload: load };
}
