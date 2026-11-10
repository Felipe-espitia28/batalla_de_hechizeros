/**
 * Perfil para la barra superior (GET /me): usuario, oro y rango.
 * Escucha los CustomEvents de los remotes (sección 9) para mantenerse al día sin estado global:
 *   - duelo:gold-changed  -> actualiza el oro con el valor recibido (sin pedir /me).
 *   - duelo:match-ended   -> vuelve a pedir /me (cambian rating, rango, oro y victorias).
 */
import { useCallback, useEffect, useState } from "react";
import { onDueloEvent, type MeResponse, type Session } from "@duelo/contracts";
import { ApiRequestError, type ApiClient } from "./api.js";

export interface ProfileState {
  profile: MeResponse | null;
  error: string | null;
  reload: () => void;
}

export function useProfile(api: ApiClient, session: Session, onSessionExpired: () => void): ProfileState {
  const [profile, setProfile] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    api
      .me(session.token)
      .then((me) => {
        if (cancelled) return;
        setProfile(me);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.isSessionExpired) {
          onSessionExpired();
          return;
        }
        setError(err instanceof Error ? err.message : "No se pudo cargar tu perfil.");
      });
    return () => {
      cancelled = true;
    };
  }, [api, session.token, version, onSessionExpired]);

  useEffect(() => {
    const offGold = onDueloEvent("duelo:gold-changed", ({ gold }) => {
      setProfile((current) => (current ? { ...current, gold } : current));
    });
    const offMatch = onDueloEvent("duelo:match-ended", () => reload());
    return () => {
      offGold();
      offMatch();
    };
  }, [reload]);

  return { profile, error, reload };
}
