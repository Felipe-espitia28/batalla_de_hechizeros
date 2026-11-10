/**
 * Arranque independiente del Ranking (sin shell), para desarrollo: `pnpm --filter @duelo/ranking dev`.
 * Hace un login real contra el api para obtener una sesión de prueba, porque /ranking/me y
 * /me/matches exigen un JWT válido. En producción la sesión la entrega el shell por props.
 */
import {
  emitDueloEvent,
  onDueloEvent,
  type ApiErrorBody,
  type AuthResponse,
  type Session,
} from "@duelo/contracts";
import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";
import { API_URL } from "./config";

const STORAGE_KEY = "ranking:dev-session";

function readSession(): Session | null {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as Session) : null;
  } catch {
    return null;
  }
}

function DevRoot() {
  const [session, setSession] = useState<Session | null>(readSession);

  // Hace lo mismo que el shell: un 401 del api devuelve al login.
  useEffect(
    () =>
      onDueloEvent("duelo:session-expired", () => {
        sessionStorage.removeItem(STORAGE_KEY);
        setSession(null);
      }),
    [],
  );

  if (!session) return <DevLogin onLogin={setSession} />;

  return (
    <>
      <div style={{ display: "flex", gap: 8, padding: "8px 16px", background: "#221e36", color: "#a39fbf", font: "13px system-ui" }}>
        <span>Modo desarrollo · {session.user.username}</span>
        {/* Simula lo que emite la Arena al terminar una partida, para probar la recarga. */}
        <button type="button" onClick={() => emitDueloEvent("duelo:match-ended", { matchId: "dev", newRating: 0 })}>
          Simular duelo:match-ended
        </button>
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem(STORAGE_KEY);
            setSession(null);
          }}
        >
          Cerrar sesión
        </button>
      </div>
      <App
        session={session}
        navigate={(path) => {
          // Sin shell no hay a dónde navegar; se deja constancia para probar el flujo.
          console.info("[ranking] navigate", path);
          alert(`El shell navegaría a ${path}`);
        }}
      />
    </>
  );
}

function DevLogin({ onLogin }: { onLogin: (session: Session) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!API_URL) {
      setError("Falta VITE_API_URL en apps/ranking/.env.local.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const body = (await response.json().catch(() => null)) as AuthResponse | ApiErrorBody | null;
      if (!response.ok || !body || "error" in body) {
        setError(body && "error" in body ? body.error.message : `El api respondió ${response.status}.`);
        return;
      }
      const session: Session = { token: body.token, user: body.user };
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      } catch {
        // Sin almacenamiento la sesión solo dura hasta recargar.
      }
      onLogin(session);
    } catch {
      setError("No hay conexión con el api. ¿Está corriendo (pnpm dev:api) o despertando?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ranking">
      <form className="rk-panel" onSubmit={(e) => void submit(e)} style={{ maxWidth: 420, margin: "40px auto", display: "grid", gap: 12 }}>
        <h1>Ranking · sesión de prueba</h1>
        <p className="rk-muted">Solo para desarrollo. Usa una cuenta del api local o de pruebas.</p>
        <label style={{ display: "grid", gap: 4 }}>
          Usuario o correo
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && (
          <p role="alert" style={{ color: "#ff7a8a" }}>
            {error}
          </p>
        )}
        <button className="rk-button rk-button--primary" type="submit" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}

// En desarrollo, el proxy de entrada de Module Federation puede evaluar este archivo dos veces;
// se reutiliza la raíz para no montar React dos veces sobre el mismo contenedor.
const container = document.getElementById("root") as HTMLElement & { __rankingRoot?: Root };
container.__rankingRoot ??= createRoot(container);
container.__rankingRoot.render(
  <StrictMode>
    <DevRoot />
  </StrictMode>,
);
