/**
 * Copia los archivos de MediaPipe a una carpeta pública de la app que los sirve.
 *
 * Por qué: R2 exige que la detección corra en el PC del jugador. Si los .wasm y el modelo se
 * cargaran desde un CDN, la demo dependería de internet y DevTools mostraría descargas externas.
 * Así quedan servidos desde el mismo origen de la app.
 *
 * Uso: node scripts/copy-assets.mjs <carpeta-destino>
 *   - <destino>/wasm/*                → copiados de @mediapipe/tasks-vision/wasm
 *   - <destino>/hand_landmarker.task  → descargado una vez del repositorio oficial de modelos
 *
 * Los archivos generados no se versionan (pesan ~20 MB); se regeneran en dev y en el build.
 */
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Modelo oficial de MediaPipe (float16, versión 1), el que indica la guía de HandLandmarker para web.
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const target = process.argv[2];
if (!target) {
  console.error("Uso: node scripts/copy-assets.mjs <carpeta-destino>");
  process.exit(1);
}
const targetDir = resolve(process.cwd(), target);

// Se resuelve desde este paquete (spell-engine), que es quien depende de MediaPipe.
const bundlePath = fileURLToPath(import.meta.resolve("@mediapipe/tasks-vision"));
const wasmSource = join(dirname(bundlePath), "wasm");
const wasmTarget = join(targetDir, "wasm");

await mkdir(wasmTarget, { recursive: true });
for (const file of await readdir(wasmSource)) {
  await copyFile(join(wasmSource, file), join(wasmTarget, file));
}
console.log(`[spell-engine] wasm copiados a ${wasmTarget}`);

const modelPath = join(targetDir, "hand_landmarker.task");
if (await exists(modelPath)) {
  console.log(`[spell-engine] modelo ya presente en ${modelPath}`);
} else {
  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    console.error(`[spell-engine] no se pudo descargar el modelo: HTTP ${response.status}`);
    process.exit(1);
  }
  await writeFile(modelPath, Buffer.from(await response.arrayBuffer()));
  console.log(`[spell-engine] modelo descargado en ${modelPath}`);
}

async function exists(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}
