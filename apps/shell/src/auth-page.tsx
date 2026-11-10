/**
 * Login y registro (P0). El login acepta usuario o correo (LoginRequest.identifier).
 * Los errores muestran el mensaje del api (credenciales, usuario o correo repetido, validación).
 */
import { useState, type FormEvent } from "react";
import type { Session } from "@duelo/contracts";
import { ApiRequestError, type ApiClient } from "./api.js";

type Mode = "login" | "register";

export function AuthPage({ api, onAuthenticated, notice }: { api: ApiClient; onAuthenticated: (s: Session) => void; notice: string | null }) {
  const [mode, setMode] = useState<Mode>("login");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "login"
          ? await api.login({ identifier, password })
          : await api.register({ username, email, password });
      onAuthenticated({ token: result.token, user: result.user });
    } catch (err) {
      setError(err instanceof ApiRequestError || err instanceof Error ? err.message : "Algo salió mal. Reintenta.");
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  return (
    <main className="auth">
      <section className="auth-card" aria-labelledby="auth-title">
        <p className="eyebrow">Duelo de hechiceros</p>
        <h1 id="auth-title">{mode === "login" ? "Entra a la arena" : "Crea tu hechicero"}</h1>
        <p className="muted">
          {mode === "login"
            ? "Dibuja hechizos con la mano y grita los definitivos. Primero, tu cuenta."
            : "Empiezas con Rayo, Escudo y Meteoro en tu grimorio."}
        </p>

        <div className="segmented" role="tablist" aria-label="Tipo de acceso">
          <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => switchMode("login")}>
            Iniciar sesión
          </button>
          <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => switchMode("register")}>
            Registrarse
          </button>
        </div>

        {notice && !error && (
          <p className="alert alert-info" role="status">
            {notice}
          </p>
        )}

        <form className="form" onSubmit={submit} noValidate>
          {mode === "login" ? (
            <label>
              Usuario o correo
              <input
                id="identifier"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </label>
          ) : (
            <>
              <label>
                Usuario
                <input
                  id="username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  minLength={3}
                  maxLength={20}
                  required
                />
                <small>De 3 a 20 caracteres: letras, números y guion bajo.</small>
              </label>
              <label>
                Correo
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
            </>
          )}
          <label>
            Contraseña
            <input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={mode === "register" ? 8 : undefined}
              required
            />
            {mode === "register" && <small>Mínimo 8 caracteres.</small>}
          </label>

          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? "Un momento…" : mode === "login" ? "Entrar" : "Crear cuenta"}
          </button>
        </form>
      </section>
    </main>
  );
}
