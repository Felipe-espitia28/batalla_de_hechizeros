/**
 * Motor local de hechizos: cámara → MediaPipe → procesador de gestos → eventos.
 * Independiente de React: la Arena lo crea en un useEffect y llama a stop() en el cleanup.
 */
import type { SpellId } from "@duelo/contracts";
import { CameraError, openCamera, stopCamera, type CameraOptions } from "./camera";
import { engineError, type SpellEngineHandlers } from "./events";
import { GestureProcessor, type GestureSnapshot } from "./gesture-processor";
import { createHandTracker, type HandTracker, type HandTrackerOptions } from "./hand-tracker";
import type { PinchOptions } from "./pinch";
import type { SpellSource } from "./spell-source";

export interface SpellEngineOptions extends HandTrackerOptions {
  /** Elemento <video> donde se muestra la cámara (puede estar oculto). */
  video: HTMLVideoElement;
  /** Hechizos del grimorio del jugador. */
  grimoire: readonly SpellId[];
  minConfidence?: number;
  /** Corregir el espejo de la cámara frontal (por defecto true). */
  mirror?: boolean;
  camera?: CameraOptions;
  pinch?: Partial<PinchOptions>;
  /** Se llama en cada fotograma procesado: para la estela y el modo de depuración. */
  onFrame?: (snapshot: GestureSnapshot, size: { width: number; height: number }) => void;
}

export class SpellEngine implements SpellSource {
  private readonly processor: GestureProcessor;
  private stream: MediaStream | null = null;
  private tracker: HandTracker | null = null;
  private rafId: number | null = null;
  private lastVideoTime = -1;
  private running = false;

  constructor(
    private readonly options: SpellEngineOptions,
    private readonly handlers: SpellEngineHandlers = {},
  ) {
    this.processor = new GestureProcessor({
      grimoire: options.grimoire,
      ...(options.minConfidence !== undefined ? { minConfidence: options.minConfidence } : {}),
      ...(options.pinch ? { pinch: options.pinch } : {}),
    });
  }

  /** Abre la cámara y carga MediaPipe. Devuelve false si falló (el error ya se emitió por onError). */
  async start(): Promise<boolean> {
    if (this.running) return true;
    this.running = true;

    try {
      this.stream = await openCamera(this.options.video, this.options.camera);
    } catch (error) {
      this.fail(error instanceof CameraError ? error.detail : engineError("CAMERA_UNSUPPORTED", error));
      return false;
    }
    // stop() pudo llamarse mientras el usuario respondía al permiso (p. ej. salió de la Arena).
    if (!this.running) return false;

    try {
      this.tracker = await createHandTracker(this.options);
    } catch (error) {
      this.fail(engineError("MEDIAPIPE_LOAD_FAILED", error));
      return false;
    }
    if (!this.running) {
      this.tracker.close();
      this.tracker = null;
      return false;
    }

    this.loop();
    return true;
  }

  /** Libera cámara, MediaPipe y el ciclo de fotogramas. Seguro de llamar varias veces. */
  stop(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.tracker?.close();
    this.tracker = null;
    stopCamera(this.stream, this.options.video);
    this.stream = null;
    this.lastVideoTime = -1;
  }

  setGrimoire(grimoire: readonly SpellId[]): void {
    this.processor.setGrimoire(grimoire);
  }

  private loop = (): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    const video = this.options.video;
    // Solo procesamos cuando la cámara entrega un fotograma nuevo (≈30 fps), no a la tasa
    // de refresco de la pantalla (60–144 Hz): ahorra la mitad o más del trabajo de MediaPipe.
    if (!this.tracker || video.readyState < 2 || video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    const time = performance.now();
    const hands = this.tracker.detect(video, time, this.options.mirror ?? true);
    const size = { width: video.videoWidth, height: video.videoHeight };
    const result = this.processor.process({ hands, ...size, time });

    this.options.onFrame?.(this.processor.getSnapshot(), size);

    switch (result?.kind) {
      case "spell":
        this.handlers.onSpell?.({ spellId: result.spellId, confidence: result.confidence });
        break;
      case "failed":
        this.handlers.onSpellFailed?.({ bestGuess: result.bestGuess, confidence: result.confidence });
        break;
      case "seal-charging":
        this.handlers.onSealCharging?.();
        break;
      case "seal-cancel":
        this.handlers.onSealCancel?.();
        break;
      case "seal-cast":
        // El Sello viaja como cualquier hechizo: el servidor exige el seal-charging previo.
        this.handlers.onSpell?.({ spellId: "silence-seal", confidence: result.confidence });
        break;
    }
  };

  private fail(error: ReturnType<typeof engineError>): void {
    this.stop();
    this.handlers.onError?.(error);
  }
}
