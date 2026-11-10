import { federation } from "@module-federation/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Remote "tienda" (sección 9): expone App; react y react-dom compartidos como singleton
// (dos copias rompen los hooks). contracts y game-rules van empaquetados aquí.
// Puertos locales: shell 5173, arena 5174, tienda 5175 (ranking queda con 5176).
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "tienda",
      filename: "remoteEntry.js",
      exposes: { "./App": "./src/App.tsx" },
      shared: {
        react: { singleton: true },
        "react-dom": { singleton: true },
      },
      // Los tipos los define packages/contracts (RemoteAppProps); no hace falta generarlos.
      dts: false,
    }),
  ],
  server: { port: 5175, strictPort: true, origin: "http://localhost:5175" },
  preview: { port: 5175, strictPort: true },
  // Module Federation usa top-level await.
  build: { target: "esnext" },
});
