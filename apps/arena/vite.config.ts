import { federation } from "@module-federation/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Remote "arena" (sección 9): expone App; react y react-dom compartidos como singleton
// (dos copias rompen los hooks). contracts, spell-engine y MediaPipe van empaquetados aquí.
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "arena",
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
  server: { port: 5174, strictPort: true, origin: "http://localhost:5174" },
  preview: { port: 5174, strictPort: true },
  // Module Federation usa top-level await.
  build: { target: "esnext" },
});
