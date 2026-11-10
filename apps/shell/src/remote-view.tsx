/**
 * Muestra un remote y le pasa RemoteAppProps.
 * Un remote caído o sin configurar muestra un error con botón de reintento:
 * nunca deja la pantalla en blanco (sección 11), y no tumba al shell ni a los otros remotes.
 */
import { Component, Suspense, lazy, useMemo, useState, type ReactNode } from "react";
import type { RemoteAppProps } from "@duelo/contracts";
import { config, type RemoteName } from "./config.js";
import { loadRemoteApp } from "./federation.js";

const LABELS: Record<RemoteName, string> = { arena: "la Arena", tienda: "la Tienda", ranking: "el Ranking" };
const TITLES: Record<RemoteName, string> = { arena: "La Arena", tienda: "La Tienda", ranking: "El Ranking" };
const ENV_NAMES: Record<RemoteName, string> = {
  arena: "VITE_REMOTE_ARENA_URL",
  tienda: "VITE_REMOTE_TIENDA_URL",
  ranking: "VITE_REMOTE_RANKING_URL",
};

interface BoundaryProps {
  name: RemoteName;
  onRetry: () => void;
  children: ReactNode;
}

/** Atrapa tanto la carga fallida del remote como un error al renderizarlo. */
class RemoteBoundary extends Component<BoundaryProps, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error(`[shell] el remote ${this.props.name} falló:`, error);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="remote-state remote-error" role="alert">
        <h2>No se pudo cargar {LABELS[this.props.name]}</h2>
        <p>
          El módulo no respondió o falló al iniciar. Si los servidores estaban dormidos, espera unos segundos y
          reintenta.
        </p>
        <div className="actions">
          <button type="button" className="button" onClick={this.props.onRetry}>
            Reintentar
          </button>
          {/* Si el remote se cayó a mitad de carga, el navegador recuerda ese fallo hasta recargar. */}
          <button type="button" className="button button-ghost" onClick={() => window.location.reload()}>
            Recargar página
          </button>
        </div>
      </div>
    );
  }
}

export function RemoteView({ name, ...props }: RemoteAppProps & { name: RemoteName }) {
  const [attempt, setAttempt] = useState(0);
  // React.lazy recuerda una carga fallida: cada reintento crea un componente nuevo
  // y vuelve a registrar el remote para pedir de nuevo su remoteEntry.js.
  const RemoteApp = useMemo(() => lazy(() => loadRemoteApp(name, attempt)), [name, attempt]);

  if (!config.remotes[name]) {
    return (
      <div className="remote-state remote-error" role="alert">
        <h2>{TITLES[name]} todavía no está disponible</h2>
        <p>
          Falta la variable <code>{ENV_NAMES[name]}</code> en la configuración del shell.
        </p>
      </div>
    );
  }

  return (
    <RemoteBoundary key={`${name}-${attempt}`} name={name} onRetry={() => setAttempt((a) => a + 1)}>
      <Suspense
        fallback={
          <div className="remote-state" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <p>Cargando {LABELS[name]}…</p>
          </div>
        }
      >
        <RemoteApp {...props} />
      </Suspense>
    </RemoteBoundary>
  );
}
