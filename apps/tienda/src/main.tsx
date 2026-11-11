/**
 * Arranque independiente de la Tienda (sin shell), para desarrollo: `pnpm --filter @duelo/tienda dev`.
 * Inicia sesión contra el api real (POST /auth/login) para obtener un JWT de prueba; en producción
 * la sesión la entrega el shell por props y este archivo no se usa.
 */
import { onDueloEvent, type AuthResponse, type Session } from "@duelo/contracts";
import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";
import { API_URL } from "./config";
import "./tienda.css";

const STORAGE_KEY = "tienda:dev-session";

function loadSession(): Session | null {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as Session) : null;
  } catch {
    return null;
  }
}

function DevRoot() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [gold, setGold] = useState<number | null>(null);

  // Hace de shell: escucha los mismos eventos que escucharía el host real.
  useEffect(() => onDueloEvent("duelo:gold-changed", (detail) => setGold(detail.gold)), []);
  useEffect(
    () =>
      onDueloEvent("duelo:session-expired", () => {
        sessionStorage.removeItem(STORAGE_KEY);
        setSession(null);
      }),
    [],
  );

  if (!session) {
    return (
      <DevLogin
        onLogin={(next) => {
          try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch {
            // Sin almacenamiento la sesión solo dura hasta recargar.
          }
          setSession(next);
        }}
      />
    );
  }

  return (
    <>
      <div className="t-devbar">
        Modo desarrollo · {session.user.username}
        {gold !== null && <> · último duelo:gold-changed = {gold}</>}
        <button
          type="button"
          className="t-link"
          onClick={() => {
            sessionStorage.removeItem(STORAGE_KEY);
            setSession(null);
          }}
        >
          Cerrar sesión
        </button>
      </div>
      <App session={session} navigate={(path) => console.info("[tienda] el shell navegaría a", path)} />
    </>
  );
}

function DevLogin({ onLogin }: { onLogin: (session: Session) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const body = (await response.json()) as AuthResponse | { error: { message: string } };
      if (!response.ok || !("token" in body)) {
        setError("error" in body ? body.error.message : `El api respondió ${response.status}`);
        return;
      }
      onLogin({ token: body.token, user: body.user });
    } catch {
      setError(API_URL ? "No se pudo conectar con el api." : "Falta VITE_API_URL en apps/tienda/.env.local.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tienda">
      <form className="t-panel t-dev-login" onSubmit={(event) => void submit(event)}>
        <h2>Tienda · sesión de prueba</h2>
        <p className="t-muted">Solo para desarrollo. En producción la sesión la entrega el shell.</p>
        <label>
          Usuario o correo
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p className="t-feedback t-feedback--error" role="alert">
            {error}
          </p>
        )}
        <button className="t-btn t-btn--primary" type="submit" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}

// En desarrollo, el proxy de entrada de Module Federation puede evaluar este archivo dos veces;
// se reutiliza la raíz para no montar React dos veces sobre el mismo contenedor (igual que la Arena).
const container = document.getElementById("root") as HTMLElement & { __tiendaRoot?: Root };
container.__tiendaRoot ??= createRoot(container);
container.__tiendaRoot.render(
  <StrictMode>
    <DevRoot />
  </StrictMode>,
);
