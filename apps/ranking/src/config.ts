/**
 * Configuración del Ranking. Ninguna URL se escribe en el código (sección 4): sale de VITE_API_URL,
 * que en Vercel se define en el proyecto del Ranking y en local en apps/ranking/.env.local.
 */
function clean(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
}

export const API_URL = clean(import.meta.env.VITE_API_URL);

/** Tras este tiempo sin respuesta se avisa que el servidor puede estar despertando (Render/Neon free). */
export const SLOW_LOAD_MS = 3000;
