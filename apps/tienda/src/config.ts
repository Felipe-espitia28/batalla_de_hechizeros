/**
 * Configuración de la Tienda. Ninguna URL se escribe en el código (sección 4 de CLAUDE.md):
 * sale de VITE_API_URL, que en Vercel se define por proyecto y en local en apps/tienda/.env.local.
 */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");
