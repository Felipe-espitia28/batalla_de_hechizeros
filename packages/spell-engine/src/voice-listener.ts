/**
 * Voz para los definitivos: micrófono → Web Audio (volumen) + Web Speech (palabra) → onUltimate.
 *
 * Qué sale del navegador: hacia NUESTRO servidor solo viaja { ultimateId, transcript } (R2).
 * Ojo: en Chrome y Edge, Web Speech envía el audio al servicio de reconocimiento de Google para
 * transcribirlo; por eso la voz necesita internet aunque los gestos funcionen sin él.
 *
 * El micrófono es opcional (sección 11): si se deniega o el navegador no reconoce voz, se avisa
 * con un error NO fatal y solo se desactivan los definitivos.
 */
import type { UltimateId } from "@duelo/contracts";
import { engineError, type SpellEngineErrorCode, type SpellEngineHandlers } from "./events";
import { ShoutDetector, type ShoutDetectorOptions } from "./shout-detector";

/**
 * Lo mínimo de SpeechRecognition (W3C Web Speech API) que se usa. TypeScript trae los tipos de
 * los eventos pero no la clase, porque Chrome solo la expone con prefijo (webkitSpeechRecognition).
 */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceListenerOptions extends Omit<ShoutDetectorOptions, "ultimateId"> {
  ultimateId: UltimateId;
  /** Idioma de Web Speech; las palabras aceptadas están en español. */
  lang?: string;
  /** Nivel 0..1 cada ~50 ms, para el medidor de volumen de la Arena. */
  onLevel?: (level: number, isShout: boolean) => void;
}

const LEVEL_INTERVAL_MS = 50;

export class VoiceListener {
  private readonly detector: ShoutDetector;
  private stream: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private recognition: SpeechRecognitionLike | null = null;
  private running = false;

  constructor(
    private readonly options: VoiceListenerOptions,
    private readonly handlers: SpellEngineHandlers = {},
  ) {
    this.detector = new ShoutDetector(options);
  }

  /** Devuelve false si los definitivos quedan desactivados (el motivo llega por onError). */
  async start(): Promise<boolean> {
    if (this.running) return true;
    const Recognition = getSpeechRecognition();
    if (!Recognition) return this.fail("SPEECH_UNSUPPORTED");
    if (!navigator.mediaDevices?.getUserMedia) return this.fail("MIC_DENIED");

    this.running = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      return this.fail(name === "NotFoundError" ? "MIC_NOT_FOUND" : "MIC_DENIED", error);
    }
    if (!this.running) {
      this.release();
      return false;
    }

    this.startLevelMeter(this.stream);
    this.startRecognition(Recognition);
    return true;
  }

  stop(): void {
    this.running = false;
    this.release();
  }

  setUltimate(ultimateId: UltimateId): void {
    this.detector.setUltimate(ultimateId);
  }

  private startLevelMeter(stream: MediaStream): void {
    this.audio = new AudioContext();
    const analyser = this.audio.createAnalyser();
    analyser.fftSize = 1024;
    this.audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    // setInterval y no requestAnimationFrame: el grito debe contar aunque el render vaya lento.
    this.levelTimer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const level = Math.sqrt(sum / samples.length);
      this.detector.feedLevel(level, performance.now());
      this.options.onLevel?.(level, this.detector.isShout(level));
    }, LEVEL_INTERVAL_MS);
  }

  private startRecognition(Recognition: SpeechRecognitionCtor): void {
    const recognition = new Recognition();
    recognition.lang = this.options.lang ?? "es-ES";
    recognition.continuous = true;
    // Resultados parciales: el definitivo sale apenas se oye la palabra, sin esperar el silencio.
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i]?.[0]?.transcript ?? "";
        const ultimate = this.detector.feedTranscript(transcript, performance.now());
        if (ultimate) this.handlers.onUltimate?.(ultimate);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") this.fail("MIC_DENIED");
      else if (event.error === "network") this.handlers.onError?.({ ...engineError("SPEECH_NETWORK"), fatal: false });
      // "no-speech" y "aborted" son normales (silencio o stop()): onend reinicia.
    };

    // Chrome corta la escucha continua tras unos segundos de silencio: se reinicia mientras dure la partida.
    recognition.onend = () => {
      if (!this.running) return;
      setTimeout(() => {
        if (this.running) safeStart(recognition);
      }, 250);
    };

    this.recognition = recognition;
    safeStart(recognition);
  }

  private fail(code: SpellEngineErrorCode, cause?: unknown): false {
    this.running = false;
    this.release();
    this.handlers.onError?.({ ...engineError(code, cause), fatal: false });
    return false;
  }

  private release(): void {
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.abort();
    }
    this.recognition = null;
    void this.audio?.close().catch(() => undefined);
    this.audio = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

function safeStart(recognition: SpeechRecognitionLike): void {
  try {
    recognition.start();
  } catch {
    // start() lanza si ya estaba escuchando; no es un error real.
  }
}
