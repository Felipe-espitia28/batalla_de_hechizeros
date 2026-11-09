/**
 * Acceso a la cámara con getUserMedia, traduciendo los errores del navegador a mensajes claros.
 * El video nunca sale del navegador: solo lo lee MediaPipe en este mismo equipo (R2).
 */
import { engineError, type SpellEngineError } from "./events";

export interface CameraOptions {
  /** 640×480 basta para MediaPipe y mantiene bajo el costo por fotograma. */
  width?: number;
  height?: number;
}

export class CameraError extends Error {
  constructor(readonly detail: SpellEngineError) {
    super(detail.message);
  }
}

export async function openCamera(video: HTMLVideoElement, options: CameraOptions = {}): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    // Pasa en http:// fuera de localhost: el navegador oculta mediaDevices.
    throw new CameraError(engineError("CAMERA_UNSUPPORTED"));
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: options.width ?? 640 }, height: { ideal: options.height ?? 480 }, facingMode: "user" },
      audio: false,
    });
  } catch (error) {
    throw new CameraError(engineError(cameraErrorCode(error), error));
  }

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null, video?: HTMLVideoElement): void {
  stream?.getTracks().forEach((track) => track.stop());
  if (video) video.srcObject = null;
}

function cameraErrorCode(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "CAMERA_DENIED" as const;
    case "NotFoundError":
    case "OverconstrainedError":
      return "CAMERA_NOT_FOUND" as const;
    case "NotReadableError":
    case "AbortError":
      return "CAMERA_IN_USE" as const;
    default:
      return "CAMERA_UNSUPPORTED" as const;
  }
}
