/**
 * URLs del shell. Ninguna se escribe en el código (sección 4): todas vienen de variables de Vite,
 * que en Vercel se definen por proyecto y en local en apps/shell/.env.local.
 */
export type RemoteName = "arena" | "tienda" | "ranking";

function clean(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
}

export const config = {
  apiUrl: clean(import.meta.env.VITE_API_URL),
  remotes: {
    arena: clean(import.meta.env.VITE_REMOTE_ARENA_URL),
    tienda: clean(import.meta.env.VITE_REMOTE_TIENDA_URL),
    ranking: clean(import.meta.env.VITE_REMOTE_RANKING_URL),
  } satisfies Record<RemoteName, string | null>,
};
