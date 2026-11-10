# game-server

Servidor de partidas en tiempo real (Socket.IO, autoritativo). Dueño: Johan Soriano.
El diseño completo está en [CLAUDE.md](../../CLAUDE.md), secciones 4, 6, 7 y 8.

## Estructura

| Archivo | Qué hace |
|---|---|
| `src/combat/engine.ts` | Reglas de combate deterministas, sin red ni reloj (se prueban con tests unitarios) |
| `src/game-service.ts` | Cola, emparejamiento, ciclo de la partida, reconexión, abandono y cierre con el api |
| `src/socket-handlers.ts` | Valida payloads (zod) y responde el ack de cada evento |
| `src/server.ts` | HTTP con `/health`, Socket.IO con JWT en el handshake y CORS |
| `src/internal-api.ts` | Llamadas a `/internal` del api con la cabecera `x-internal-key` |
| `src/store/live-store.ts` | Espejo en Redis (claves `dh:` de la sección 8) |
| `scripts/` | Clientes de consola para probar sin la Arena |

## Variables de entorno

Ver `.env.example`; los valores están en Bitwarden.

| Variable | Desarrollo | Producción (Render) |
|---|---|---|
| `PORT` | 3001 por defecto | La pone Render |
| `JWT_SECRET` | Obligatoria, igual que en `services/api` | Obligatoria |
| `REDIS_URL` | Opcional: sin ella la cola vive solo en memoria | Obligatoria (Upstash, `rediss://…`) |
| `API_INTERNAL_URL` | Opcional: sin ella se usa un api simulado (grimorio inicial, rating en memoria) | Obligatoria |
| `INTERNAL_API_KEY` | Obligatoria si hay `API_INTERNAL_URL` | Obligatoria |
| `ALLOWED_ORIGINS` | Opcional: vacía acepta cualquier origen | Obligatoria, separada por comas |

Se considera producción si `NODE_ENV=production` o `RENDER=true` (Render la define sola). En producción el
proceso no arranca si falta una variable obligatoria, con un mensaje que dice cuál.

## Probar en local

```bash
pnpm --filter @duelo/game-server test
pnpm dev:game
pnpm --filter @duelo/game-server duel              # partida automática entre dos clientes
pnpm --filter @duelo/game-server duel -- --abandon # victoria por abandono
pnpm --filter @duelo/game-server client -- --name ana          # manual: r, e, f, q
pnpm --filter @duelo/game-server client -- --token <JWT del api> --auto
```

Con el api real: `API_INTERNAL_URL=http://localhost:4000` y el mismo `JWT_SECRET` e `INTERNAL_API_KEY` que
`services/api/.env`. Las cuentas se crean con `POST /auth/register` y su token se pasa con `--token`.

Tests contra un Redis real (opcional; usa la base 15 y la vacía):

```bash
pnpm db:up
REDIS_TEST_URL=redis://localhost:6379/15 pnpm --filter @duelo/game-server test
```

## Errores del api

| Momento | Qué falla | Qué pasa |
|---|---|---|
| `matchmaking:join` (loadout) | 404, 5xx, timeout de 10 s o api apagado | Ack `INTERNAL_ERROR` y error en el log con el código HTTP. Nunca `UNAUTHORIZED`: el JWT ya se validó en el handshake, y responder eso mandaba al jugador al login |
| Fin de partida (registro) | El api no responde | Ver la sección siguiente |

## Si el api no responde al cerrar la partida

Decisión: **los jugadores nunca esperan al api más de 5 s**, y el registro se sigue intentando aparte.

1. Al terminar, se envía `POST /internal/matches` y se espera la respuesta **hasta 5 s**.
2. Si llega a tiempo, `match:end` lleva las recompensas que devolvió el api (fuente de verdad).
3. Si no llega, `match:end` sale igual con **recompensas provisionales** calculadas con la misma economía de
   `@duelo/game-rules` (`applyMatchReward`) a partir del rating que el api dio al empezar. La partida se
   libera y los jugadores pueden volver a la cola.
4. El registro sigue reintentando en segundo plano: **4 intentos** de hasta 15 s, con esperas de 2, 4 y 8 s
   (unos 74 s en total, lo que tarda Render free en despertar el api). Es seguro porque el endpoint es
   idempotente por `matchId`.
5. Los 5xx y los timeouts se reintentan; los 4xx no (payload o clave inválidos no mejoran).
6. Si todos fallan, queda `no se pudo registrar la partida en el api` en el log con el `matchId`, y esa
   partida no cuenta en el ranking.

Por qué no esperar más: con Render free dormido, esperar el minuto completo dejaría a los dos jugadores
mirando la pantalla de fin sin resultado. Por qué no un reintento persistente (cola en Redis): añade
complejidad y comandos de Upstash para un caso que se evita despertando los servicios antes de la demo.

## Redis (sección 8)

La memoria del proceso es la fuente de verdad (una sola instancia); Redis es un espejo que **solo se escribe**
en momentos clave y nunca en el tick de 100 ms ni en el ciclo de matchmaking de 1 s.

| Clave | Cuándo se escribe | TTL |
|---|---|---|
| `dh:mm:queue` | Al entrar o salir de la cola y al emparejar; se vacía al arrancar | Sin TTL |
| `dh:mm:ticket:{userId}` | Al entrar en la cola (grimorio validado y hora) | 120 s |
| `dh:match:{matchId}` | Al empezar la cuenta regresiva, tras cada hechizo resuelto y al terminar | 300 s |
| `dh:user:{userId}:match` | Al crear la partida; se borra al terminar | 300 s |

Medido con Redis local: una partida de ~25 hechizos usa unos **70 comandos**, unas 7 000 partidas al mes
dentro de los 500 000 comandos de Upstash free. Si Redis falla, se registra y la partida sigue.

## Despliegue en Render

| Campo | Valor |
|---|---|
| Root Directory | (vacío: raíz del monorepo) |
| Build Command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @duelo/game-server build` |
| Start Command | `pnpm --filter @duelo/game-server start` |
| Health Check Path | `/health` |

- `build` compila primero `@duelo/game-rules` (`build:deps`); `@duelo/contracts` lo compila el `postinstall`
  de la raíz.
- El servidor escucha en `PORT` y el socket solo acepta los orígenes de `ALLOWED_ORIGINS`.
- **SIGTERM** (redespliegue): deja de aceptar conexiones, espera los registros de partida pendientes con un
  tope de 25 s (Render mata el proceso a los 30 s) y cierra Redis. Las partidas en curso se pierden: no
  redesplegar durante la demo.
