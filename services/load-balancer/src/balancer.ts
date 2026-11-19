/**
 * Reparto por turnos (round-robin) entre las copias del api, con revisión de salud.
 *
 * - Cada copia se revisa con GET /health; la que falla sale de la rotación y vuelve sola al
 *   responder de nuevo.
 * - Si TODAS parecen caídas se reparte igual entre todas: en Render free las copias se duermen
 *   tras 15 min y es justo una petición la que las despierta. Mejor intentar que devolver 502.
 */
import type { BackendConfig } from "./config.js";

export interface Backend extends BackendConfig {
  healthy: boolean;
  /** Peticiones que atendió (para /lb/status y la demo). */
  served: number;
  lastError: string | null;
  lastCheckAt: number | null;
}

export interface BalancerOptions {
  healthIntervalMs: number;
  /** Tiempo máximo de cada revisión de salud. */
  healthTimeoutMs?: number;
  /** Se llama cuando una copia cambia de sana a caída o al revés. */
  onHealthChange?: (backend: Backend) => void;
}

export class Balancer {
  readonly backends: Backend[];
  private cursor = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly healthTimeoutMs: number;

  constructor(
    configs: readonly BackendConfig[],
    private readonly options: BalancerOptions,
  ) {
    // Se empieza suponiendo que están sanas: la primera revisión corrige en segundos.
    this.backends = configs.map((c) => ({ ...c, healthy: true, served: 0, lastError: null, lastCheckAt: null }));
    this.healthTimeoutMs = options.healthTimeoutMs ?? 5000;
  }

  /** La siguiente copia en turno, saltándose las caídas y las de `exclude` (reintentos). */
  next(exclude: ReadonlySet<Backend> = new Set()): Backend | null {
    const candidates = this.backends.filter((b) => !exclude.has(b));
    if (candidates.length === 0) return null;
    const healthy = candidates.filter((b) => b.healthy);
    const pool = healthy.length > 0 ? healthy : candidates;
    // El cursor recorre la lista completa para que el turno no dependa de cuántas estén sanas.
    for (let i = 0; i < this.backends.length; i++) {
      const backend = this.backends[(this.cursor + i) % this.backends.length]!;
      if (pool.includes(backend)) {
        this.cursor = (this.backends.indexOf(backend) + 1) % this.backends.length;
        return backend;
      }
    }
    return pool[0] ?? null;
  }

  /** Error de red al reenviar: la copia sale de la rotación hasta la próxima revisión sana. */
  markDown(backend: Backend, reason: string): void {
    backend.lastError = reason;
    this.setHealthy(backend, false);
  }

  start(): void {
    if (this.timer) return;
    void this.checkAll();
    this.timer = setInterval(() => void this.checkAll(), this.options.healthIntervalMs);
    // No mantiene vivo el proceso por sí solo (Ctrl+C y las pruebas terminan sin esperar).
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async checkAll(): Promise<void> {
    await Promise.all(this.backends.map((backend) => this.check(backend)));
  }

  private async check(backend: Backend): Promise<void> {
    const url = new URL("health", `${backend.url.href.replace(/\/+$/, "")}/`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(this.healthTimeoutMs) });
      backend.lastCheckAt = Date.now();
      if (response.ok) {
        backend.lastError = null;
        this.setHealthy(backend, true);
      } else {
        backend.lastError = `/health respondió ${response.status}`;
        this.setHealthy(backend, false);
      }
    } catch (error) {
      backend.lastCheckAt = Date.now();
      backend.lastError = error instanceof Error ? error.message : String(error);
      this.setHealthy(backend, false);
    }
  }

  private setHealthy(backend: Backend, healthy: boolean): void {
    if (backend.healthy === healthy) return;
    backend.healthy = healthy;
    this.options.onHealthChange?.(backend);
  }

  status() {
    return this.backends.map((b) => ({
      name: b.name,
      url: b.url.origin + b.url.pathname.replace(/\/+$/, ""),
      healthy: b.healthy,
      served: b.served,
      lastError: b.lastError,
      lastCheckAt: b.lastCheckAt,
    }));
  }
}
