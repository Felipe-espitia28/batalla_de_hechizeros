/**
 * Arranque independiente de la Arena (sin shell), para desarrollo: `pnpm --filter @duelo/arena dev`.
 * Pide una sesión de prueba: un JWT real del api o, contra el servidor simulado, "dev:<usuario>".
 */
import type { JwtClaims, Session } from "@duelo/contracts";
import { StrictMode, useState, type FormEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";

const STORAGE_KEY = "arena:dev-session";

function DevRoot() {
  const [session, setSession] = useState<Session | null>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      return saved ? (JSON.parse(saved) as Session) : null;
    } catch {
      return null;
    }
  });

  if (!session) return <DevLogin onLogin={setSession} />;

  return (
    <App
      session={session}
      navigate={(path) => {
        // Sin shell no hay a dónde navegar; se deja constancia para probar el flujo.
        console.info("[arena] navigate", path);
        alert(`El shell navegaría a ${path}`);
      }}
    />
  );
}

function DevLogin({ onLogin }: { onLogin: (s: Session) => void }) {
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = username.trim() || `mago${Math.floor(Math.random() * 1000)}`;
    // El servidor simulado (dev/mock-game-server.ts) acepta "dev:<usuario>"; el real exige un JWT.
    const jwt = token.trim();
    const claims = jwt ? readClaims(jwt) : null;
    if (jwt && !claims) {
      alert("Ese token no parece un JWT válido.");
      return;
    }
    // Con JWT real, el id y el nombre salen del token: deben coincidir con los del game-server.
    const session: Session = claims
      ? { token: jwt, user: { id: claims.sub, username: claims.username } }
      : { token: `dev:${name}`, user: { id: `dev-${name}`, username: name } };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Sin almacenamiento la sesión solo dura hasta recargar.
    }
    onLogin(session);
  };

  return (
    <form className="arena" onSubmit={submit} style={{ maxWidth: 420, margin: "40px auto" }}>
      <h2>Arena · sesión de prueba</h2>
      <p className="muted">Solo para desarrollo. En producción la sesión la entrega el shell.</p>
      <label>
        Usuario
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="mago123" style={{ display: "block", width: "100%" }} />
      </label>
      <label>
        Token JWT (opcional: vacío = servidor simulado)
        <input value={token} onChange={(e) => setToken(e.target.value)} style={{ display: "block", width: "100%" }} />
      </label>
      <button className="btn btn--primary" type="submit">
        Entrar
      </button>
    </form>
  );
}

/** Lee (sin verificar) los claims del JWT; verificarlo es trabajo del servidor. */
function readClaims(jwt: string): JwtClaims | null {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as Partial<JwtClaims>;
    return claims.sub && claims.username ? (claims as JwtClaims) : null;
  } catch {
    return null;
  }
}

// En desarrollo, el proxy de entrada de Module Federation puede evaluar este archivo dos veces;
// se reutiliza la raíz para no montar React dos veces sobre el mismo contenedor.
const container = document.getElementById("root") as HTMLElement & { __arenaRoot?: Root };
container.__arenaRoot ??= createRoot(container);
container.__arenaRoot.render(
  <StrictMode>
    <DevRoot />
  </StrictMode>,
);
