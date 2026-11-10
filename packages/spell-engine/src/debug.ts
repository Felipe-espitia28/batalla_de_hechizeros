/**
 * Dibujo del modo de depuración y de la estela sobre un <canvas> superpuesto al video.
 * Canvas 2D sin librerías (sección 3). La Arena puede reutilizar `drawStroke` para la estela.
 */
import type { Point } from "./geometry";
import { HAND_CONNECTIONS, INDEX_TIP, THUMB_TIP } from "./hand";
import type { GestureSnapshot } from "./gesture-processor";

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: readonly Point[], color = "#7c5cff"): void {
  if (stroke.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(stroke[0]!.x, stroke[0]!.y);
  for (const p of stroke.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.restore();
}

export function drawDebug(ctx: CanvasRenderingContext2D, snapshot: GestureSnapshot): void {
  ctx.save();
  for (const hand of snapshot.hands) {
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 2;
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(hand[a]!.x, hand[a]!.y);
      ctx.lineTo(hand[b]!.x, hand[b]!.y);
      ctx.stroke();
    }
    hand.forEach((p, i) => {
      const isPinchPoint = i === THUMB_TIP || i === INDEX_TIP;
      ctx.fillStyle = isPinchPoint ? (snapshot.isPinched ? "#22c55e" : "#f59e0b") : "#e5e7eb";
      ctx.beginPath();
      ctx.arc(p.x, p.y, isPinchPoint ? 6 : 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.restore();
}
