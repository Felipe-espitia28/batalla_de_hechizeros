/**
 * Adaptador de MediaPipe Tasks Vision (HandLandmarker). Único archivo que importa MediaPipe.
 *
 * Los .wasm y el modelo se sirven desde la propia app (rutas relativas, no CDN): así se demuestra
 * en DevTools → Network que todo corre en el equipo y la detección sigue sin internet (R2).
 * Ver scripts/copy-assets.mjs.
 */
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { Hand } from "./hand";

export interface HandTrackerOptions {
  /** Carpeta servida con los archivos de @mediapipe/tasks-vision/wasm. */
  wasmBasePath: string;
  /** Ruta servida del modelo hand_landmarker.task. */
  modelAssetPath: string;
}

export interface HandTracker {
  /** Detecta manos en el fotograma actual del video, en píxeles y en espejo si `mirror`. */
  detect(video: HTMLVideoElement, timestamp: number, mirror: boolean): Hand[];
  close(): void;
}

export async function createHandTracker(options: HandTrackerOptions): Promise<HandTracker> {
  const fileset = await FilesetResolver.forVisionTasks(options.wasmBasePath);

  const create = (delegate: "GPU" | "CPU") =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: options.modelAssetPath, delegate },
      runningMode: "VIDEO",
      // 2 manos desde ya: la X del Sello las necesita y así el procesador pausa el dibujo.
      numHands: 2,
    });

  let landmarker: HandLandmarker;
  try {
    landmarker = await create("GPU");
  } catch {
    // Algunos PCs (sin WebGL2 o con drivers viejos) fallan con GPU; en CPU va más lento pero va.
    landmarker = await create("CPU");
  }

  return {
    detect(video, timestamp, mirror) {
      const result = landmarker.detectForVideo(video, timestamp);
      const width = video.videoWidth;
      const height = video.videoHeight;
      return result.landmarks.map((landmarks) =>
        landmarks.map((l) => ({
          // El jugador se ve en espejo; invertimos x para que "izquierda → derecha" sea la suya.
          x: (mirror ? 1 - l.x : l.x) * width,
          y: l.y * height,
        })),
      );
    },
    close() {
      landmarker.close();
    },
  };
}
