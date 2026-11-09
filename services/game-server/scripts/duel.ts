/**
 * Duelo automático entre dos clientes de consola contra un game-server ya levantado.
 *
 *   pnpm --filter @duelo/game-server duel                 (partida completa, ~90 s o KO)
 *   pnpm --filter @duelo/game-server duel -- --abandon    (beto se va a los 5 s: victoria por abandono)
 *
 * Requiere el servidor corriendo (`pnpm dev:game`) y JWT_SECRET en services/game-server/.env.
 */
import { parseArgs } from "node:util";
import { defaultUrl, devToken, runConsoleClient } from "./console-client.js";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    abandon: { type: "boolean", default: false },
  },
});
const url = values.url ?? defaultUrl();

const [ana, beto] = await Promise.all([
  runConsoleClient({ url, token: devToken("ana"), label: "ana ", auto: true }),
  runConsoleClient({
    url,
    token: devToken("beto"),
    label: "beto",
    auto: true,
    ...(values.abandon ? { quitAfterMs: 5_000 } : {}),
  }),
]);

const end = ana ?? beto;
if (!end) {
  console.error("La partida no terminó (¿servidor apagado o JWT_SECRET distinto?)");
  process.exit(1);
}
console.log(`\nResultado: ${end.reason}, ganador ${end.winnerId ?? "ninguno (empate)"}`);
process.exit(0);
