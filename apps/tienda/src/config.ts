/**
 * Configuración de la Tienda. Ninguna URL se escribe en el código (sección 4 de CLAUDE.md):
 * sale de VITE_API_URL, que en Vercel se define por proyecto y en local en apps/tienda/.env.local.
 */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");

/**
 * Iconos del diseño (public/ui), resueltos contra el origen de ESTE módulo y no de la página:
 * dentro del shell, "/ui/..." apuntaría al dominio del shell y daría 404.
 * Ojo: no usar `new URL("/ruta", import.meta.url)`; Vite reescribe ese patrón como asset propio.
 */
const TIENDA_ORIGIN = new URL(import.meta.url).origin;
export const UI_ASSETS_PATH = `${TIENDA_ORIGIN}/ui`;
