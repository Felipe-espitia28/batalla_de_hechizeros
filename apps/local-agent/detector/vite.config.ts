import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Ventana del detector: página estática que sirve el propio agente desde dist/detector.
// public/mediapipe (wasm y modelo) se copia con "pnpm run assets": así no depende de ningún CDN.
const detectorDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: detectorDir,
  publicDir: "public",
  // Rutas relativas: el agente la sirve en la raíz de 127.0.0.1:AGENT_PORT.
  base: "./",
  build: {
    outDir: fileURLToPath(new URL("../dist/detector", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
  },
});
