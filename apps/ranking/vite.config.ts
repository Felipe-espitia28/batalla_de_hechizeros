import { federation } from "@module-federation/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Remote "ranking" (sección 9): expone App; react y react-dom compartidos como singleton
// (dos copias rompen los hooks). contracts y game-rules van empaquetados aquí.
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "ranking",
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
  server: { port: 5176, strictPort: true, origin: "http://localhost:5176" },
  preview: { port: 5176, strictPort: true },
  // Module Federation usa top-level await.
  build: { target: "esnext" },
});
