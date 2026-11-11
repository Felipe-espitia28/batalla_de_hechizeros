/**
 * Página de prueba del módulo local, sin React ni Arena: sirve para afinar umbrales y medir
 * la tasa de acierto con la cámara real antes de integrarlo en el juego.
 */
import type { SpellId } from "@duelo/contracts";
import { SpellEngine, drawDebug, drawSeal, drawStroke, type SpellFailedEvent, type SpellEvent } from "../src";

// Todas las figuras a la vez: es el caso más difícil para el $1 (más candidatos con qué confundirse).
const GRIMOIRE: SpellId[] = ["lightning", "shield", "slash", "fireball", "heal", "poison", "freeze", "silence-seal"];
const LABELS: Partial<Record<SpellId, string>> = {
  lightning: "⚡ Rayo",
  shield: "🛡️ Escudo",
  slash: "🗡️ Corte",
  fireball: "🔥 Fuego",
  heal: "💚 Curación",
  poison: "🐍 Veneno",
  freeze: "❄️ Congelar",
  "silence-seal": "✖️ Sello",
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>("video");
const canvas = $<HTMLCanvasElement>("canvas");
const ctx = canvas.getContext("2d")!;
const overlay = $("overlay");
const startButton = $<HTMLButtonElement>("start");
const stopButton = $<HTMLButtonElement>("stop");
const debugToggle = $<HTMLInputElement>("debug");
const errorBox = $("error");
const resultEl = $("result");
const resultDetail = $("result-detail");
const targetSelect = $<HTMLSelectElement>("target");
const statsBody = $("stats");
const log = $("log");

interface Stats {
  attempts: number;
  hits: number;
  confused: number;
  failed: number;
}
const stats = new Map<SpellId, Stats>(GRIMOIRE.map((id) => [id, { attempts: 0, hits: 0, confused: 0, failed: 0 }]));

function renderStats(): void {
  statsBody.innerHTML = "";
  for (const [id, s] of stats) {
    const pct = s.attempts ? Math.round((100 * s.hits) / s.attempts) : 0;
    const row = document.createElement("tr");
    for (const value of [LABELS[id] ?? id, s.attempts, s.hits, s.confused, s.failed, s.attempts ? `${pct} %` : "—"]) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.append(cell);
    }
    statsBody.append(row);
  }
}

function record(outcome: "hit" | "confused" | "failed", text: string): void {
  const target = targetSelect.value as SpellId;
  const s = stats.get(target)!;
  s.attempts++;
  if (outcome === "hit") s.hits++;
  else if (outcome === "confused") s.confused++;
  else s.failed++;
  renderStats();

  const item = document.createElement("li");
  item.textContent = `${LABELS[target]} → ${text}`;
  log.prepend(item);
}

function onSpell({ spellId, confidence }: SpellEvent): void {
  resultEl.textContent = LABELS[spellId] ?? spellId;
  resultEl.className = "result ok";
  resultDetail.textContent = `Confianza ${confidence.toFixed(2)} · esto es lo que viajaría al servidor`;
  const hit = spellId === targetSelect.value;
  record(hit ? "hit" : "confused", `${LABELS[spellId] ?? spellId} (${confidence.toFixed(2)})`);
}

function onSpellFailed({ bestGuess, confidence }: SpellFailedEvent): void {
  resultEl.textContent = "¡Hechizo fallido!";
  resultEl.className = "result bad";
  resultDetail.textContent = bestGuess
    ? `Se parecía a ${LABELS[bestGuess] ?? bestGuess} con ${confidence.toFixed(2)} (< 0,80)`
    : "No se parece a ningún hechizo del grimorio";
  record("failed", `fallido${bestGuess ? ` (${LABELS[bestGuess]} ${confidence.toFixed(2)})` : ""}`);
}

const engine = new SpellEngine(
  {
    video,
    // Rutas relativas al origen de la página: los archivos los sirve Vite desde playground/public.
    wasmBasePath: "/mediapipe/wasm",
    modelAssetPath: "/mediapipe/hand_landmarker.task",
    grimoire: GRIMOIRE,
    onFrame(snapshot, size) {
      if (canvas.width !== size.width || canvas.height !== size.height) {
        canvas.width = size.width;
        canvas.height = size.height;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (debugToggle.checked) drawDebug(ctx, snapshot);
      drawStroke(ctx, snapshot.stroke);
      drawSeal(ctx, snapshot);
      overlay.textContent =
        snapshot.sealProgress !== null ? "✖️ Cargando el Sello…" : snapshot.twoHandsPaused ? "Dos manos: cruza los índices en X" : "";
    },
  },
  {
    onSpell,
    onSpellFailed,
    onError(error) {
      errorBox.style.display = "block";
      errorBox.textContent = error.message;
      overlay.textContent = "";
      console.error("[spell-engine]", error.code, error.cause);
      setRunning(false);
    },
  },
);

function setRunning(running: boolean): void {
  startButton.disabled = running;
  stopButton.disabled = !running;
}

startButton.addEventListener("click", async () => {
  errorBox.style.display = "none";
  overlay.textContent = "Cargando cámara y detector de manos…";
  setRunning(true);
  if (await engine.start()) overlay.textContent = "";
});

stopButton.addEventListener("click", () => {
  engine.stop();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  overlay.textContent = "Cámara detenida.";
  setRunning(false);
});

$("reset").addEventListener("click", () => {
  for (const s of stats.values()) Object.assign(s, { attempts: 0, hits: 0, confused: 0, failed: 0 });
  log.innerHTML = "";
  renderStats();
});

// Libera la cámara si se cierra o recarga la pestaña.
window.addEventListener("pagehide", () => engine.stop());

renderStats();
