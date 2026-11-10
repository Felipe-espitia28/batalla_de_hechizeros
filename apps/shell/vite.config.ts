import { federation } from "@module-federation/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Host de Module Federation (sección 9 de CLAUDE.md).
 *
 * Los remotes NO se declaran aquí: se registran en tiempo de ejecución (src/federation.ts)
 * desde VITE_REMOTE_*_URL. Declarados aquí, el arranque espera a todos sus remoteEntry.js y
 * un remote caído deja el shell entero en blanco. Así cada uno falla por separado, y
 * redesplegar un remote en su misma URL no obliga a recompilar el shell (R7).
 */
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "shell",
      remotes: {},
      // Una sola copia de React para el shell y los remotes: dos copias rompen los hooks.
      // react-router-dom no se comparte: solo el shell enruta.
      shared: {
        react: { singleton: true },
        "react-dom": { singleton: true },
      },
      // Los tipos de los remotes vienen de @duelo/contracts (RemoteAppProps).
      dts: false,
    }),
  ],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  // Module Federation usa top-level await.
  build: { target: "esnext" },
});
