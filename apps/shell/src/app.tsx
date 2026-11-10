/**
 * Shell: dueño de la sesión y de la navegación (sección 9).
 * La sesión vive aquí y baja a cada remote por props; los remotes avisan con CustomEvents.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { onDueloEvent, type Session } from "@duelo/contracts";
import { createApiClient, type ApiClient } from "./api.js";
import { AuthPage } from "./auth-page.js";
import { config, type RemoteName } from "./config.js";
import { RemoteView } from "./remote-view.js";
import { clearSession, loadSession, saveSession } from "./session.js";
import { useProfile } from "./use-profile.js";

const SECTIONS: { name: RemoteName; path: string; label: string }[] = [
  { name: "arena", path: "/arena", label: "Arena" },
  { name: "tienda", path: "/tienda", label: "Tienda" },
  { name: "ranking", path: "/ranking", label: "Ranking" },
];

export function App() {
  const api = useMemo(() => createApiClient(config.apiUrl), []);
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(() => loadSession(localStorage));
  const [notice, setNotice] = useState<string | null>(null);

  const signIn = useCallback(
    (next: Session) => {
      saveSession(localStorage, next);
      setSession(next);
      setNotice(null);
      navigate("/arena", { replace: true });
    },
    [navigate],
  );

  const signOut = useCallback(
    (message: string | null = null) => {
      clearSession(localStorage);
      setSession(null);
      setNotice(message);
      navigate("/login", { replace: true });
    },
    [navigate],
  );

  const expire = useCallback(() => signOut("Tu sesión expiró. Vuelve a iniciar sesión."), [signOut]);

  // Cualquier remote que reciba un 401 emite duelo:session-expired: el shell lleva al login.
  useEffect(() => onDueloEvent("duelo:session-expired", expire), [expire]);

  return (
    <Routes>
      <Route
        path="/login"
        element={session ? <Navigate to="/arena" replace /> : <AuthPage api={api} onAuthenticated={signIn} notice={notice} />}
      />
      <Route
        element={
          session ? (
            <Layout api={api} session={session} onSignOut={() => signOut()} onExpired={expire} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route index element={<Navigate to="/arena" replace />} />
        {SECTIONS.map((section) => (
          <Route
            key={section.name}
            path={`${section.path}/*`}
            element={session && <RemoteView name={section.name} session={session} navigate={(path) => navigate(path)} />}
          />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function Layout({
  api,
  session,
  onSignOut,
  onExpired,
}: {
  api: ApiClient;
  session: Session;
  onSignOut: () => void;
  onExpired: () => void;
}) {
  const { profile, error, reload } = useProfile(api, session, onExpired);

  return (
    <div className="layout">
      <header className="topbar">
        <NavLink to="/arena" className="brand">
          Duelo de hechiceros
        </NavLink>
        <nav aria-label="Secciones">
          {SECTIONS.map((section) => (
            <NavLink key={section.name} to={section.path} className="navlink">
              {section.label}
            </NavLink>
          ))}
        </nav>
        <div className="player" aria-live="polite">
          {profile ? (
            <>
              <span className="player-name">{profile.username}</span>
              <span className="chip chip-rank" title={`${profile.rating} puntos de rango`}>
                {profile.rank}
              </span>
              <span className="chip chip-gold" title="Oro arcano">
                <span className="num">{profile.gold}</span> oro
              </span>
            </>
          ) : error ? (
            <button type="button" className="link-button" onClick={reload} title={error}>
              Perfil no disponible · reintentar
            </button>
          ) : (
            <span className="muted">{session.user.username}</span>
          )}
          <button type="button" className="button button-ghost" onClick={onSignOut}>
            Salir
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

function NotFound() {
  return (
    <div className="remote-state">
      <h2>Esta página no existe</h2>
      <NavLink to="/arena" className="button">
        Ir a la Arena
      </NavLink>
    </div>
  );
}
