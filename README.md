# Duelo de hechiceros

Juego web 1 contra 1 en tiempo real: cada jugador lanza hechizos dibujando gestos frente a su cámara (MediaPipe corre en su propio PC) y activa los definitivos gritando su nombre. Proyecto final de Arquitectura de Software · Ingeniería de Sistemas · 2026.

El diseño completo (reglas del juego, contratos, esquemas de datos y convenciones) está en [CLAUDE.md](CLAUDE.md), que es la fuente de verdad. El guion de la sustentación está en [docs/guion.md](docs/guion.md).

**Equipo:** Felipe Espitia · Juan Arias · Johan Soriano · Angel Arenales · Daniel Tapiero.

## Arquitectura

```mermaid
flowchart LR
  subgraph PC["PC del jugador (navegador)"]
    LOCAL["spell-engine (módulo local)<br/>MediaPipe + reconocedor de gestos<br/>Web Audio + Web Speech"]
    SHELL["Shell (host)<br/>login, sesión, navegación"]
    ARENA["Remote Arena"]
    TIENDA["Remote Tienda"]
    RANK["Remote Ranking"]
    LOCAL -- "{ spellId, confidence }" --> ARENA
    SHELL -. "Module Federation" .-> ARENA & TIENDA & RANK
  end
  subgraph NUBE["Nube (capas gratuitas)"]
    GS["game-server<br/>Socket.IO, autoritativo"]
    API["api<br/>Express + Prisma"]
    PG[("PostgreSQL<br/>Neon")]
    RD[("Redis<br/>Upstash")]
  end
  ARENA -- "WSS + JWT" --> GS
  SHELL & TIENDA & RANK -- "HTTPS + JWT" --> API
  GS -- "/internal: loadout y resultado" --> API
  GS --> RD
  API --> PG & RD
```

- **Módulo local:** la cámara y el micrófono se procesan en el navegador del jugador. Al servidor solo viajan eventos pequeños (`{ spellId, confidence }`), nunca video ni audio.
- **Servidor autoritativo:** el cliente solo dice "lancé X". El `game-server` valida maná, cooldowns y grimorio, y decide el daño. La partida vive en su memoria (tick de 100 ms).
- **Dos bases de datos:** PostgreSQL guarda lo permanente (usuarios, inventario, partidas). Redis guarda lo vivo (cola de emparejamiento, instantáneas de partida y el ranking `dh:ranking`). Si Redis falla, el ranking responde desde PostgreSQL.
- **Micro frontends:** el shell carga cada remote en tiempo de ejecución desde su propia URL. Cada uno se despliega por separado, y si uno cae el resto sigue funcionando.

### Cómo se cumple cada requisito

| Req. | Requisito | Qué lo cumple |
|---|---|---|
| R1 | Desplegado en la nube | Vercel (4 frontends), Render (api y game-server), Neon, Upstash |
| R2 | Módulo local | `packages/spell-engine`: MediaPipe y reconocedor en el PC del jugador |
| R3 | Sockets | `services/game-server` con Socket.IO |
| R4 | Cámara y micrófono | Gestos con la cámara; definitivos gritando al micrófono |
| R5 | Mínimo 2 bases de datos | PostgreSQL (Neon) + Redis (Upstash) |
| R6 | Código en GitHub | Este monorepo: PRs revisados y GitHub Actions en verde |
| R7 | Micro frontends | Shell + 3 remotes con Module Federation, cada uno con su URL |

## URLs desplegadas

| Parte | URL |
|---|---|
| Shell | _pendiente_ (`https://duelohechiceros.qd.je` cuando se delegue el DNS) |
| Arena | _pendiente_ (`https://arena.duelohechiceros.qd.je`) |
| Tienda | _pendiente_ (`https://tienda.duelohechiceros.qd.je`) |
| Ranking | _pendiente_ (`https://ranking.duelohechiceros.qd.je`) |
| api | _pendiente_ (`https://api.duelohechiceros.qd.je`) |
| game-server | _pendiente_ (`https://game.duelohechiceros.qd.je`) |

> Mientras el dominio propio no esté delegado, cada parte funciona en su URL por defecto de Vercel (`*.vercel.app`) o Render (`*.onrender.com`). Rellenar esta tabla con las URLs reales antes del 14 de noviembre.
>
> En el plan gratuito, Render duerme los servicios tras 15 minutos sin uso (tardan ~1 minuto en despertar) y Neon suspende la base tras 5 minutos. Antes de una demostración, abre el shell y el ranking unos minutos antes.

## Estructura

```text
apps/          Micro frontends: shell (host), arena, tienda, ranking
services/      Backends: api (Express + Prisma), game-server (Socket.IO)
packages/      Compartido: contracts, game-rules, spell-engine, ui
docs/          Hoja de hechizos, DNS, guion
```

| Carpeta | Dueño |
|---|---|
| `apps/shell`, `services/api` (auth), `.github/`, raíz | Felipe Espitia |
| `packages/spell-engine`, `apps/arena` | Juan Arias |
| `services/game-server` | Johan Soriano |
| `apps/tienda`, `services/api` (tienda), `packages/ui` | Angel Arenales |
| `apps/ranking`, `services/api` (ranking) | Daniel Tapiero |

`packages/contracts` y `packages/game-rules` son compartidos: cualquier cambio se avisa al equipo antes de subirlo.

## Requisitos

- **Node.js 22 o superior** (probado con 24).
- **pnpm 12** (la versión exacta está fijada en `packageManager` del `package.json`). La forma más simple es Corepack, que viene con Node:

  ```bash
  corepack enable
  ```

  Si `corepack enable` falla por permisos en Windows, abre la terminal como administrador o usa `npm install -g pnpm@12.18.0`.
- **Docker Desktop** para Postgres y Redis locales.

## Levantar en local

1. Instalar dependencias (compila `@duelo/contracts` automáticamente en el `postinstall`):

   ```bash
   pnpm install
   ```

2. Levantar las bases de datos (Postgres en `5432`, Redis en `6379`):

   ```bash
   pnpm db:up
   ```

3. Crear los archivos de entorno a partir de los ejemplos y rellenarlos. Los valores de la nube están en Bitwarden; **nunca** se suben al repo.

   | Ejemplo | Copiar a |
   |---|---|
   | `services/api/.env.example` | `services/api/.env` |
   | `services/game-server/.env.example` | `services/game-server/.env` |
   | `apps/*/.env.example` | `apps/*/.env.local` |

   Valores para desarrollo local con el `docker-compose.yml`:

   ```text
   DATABASE_URL=postgresql://duelo:duelo@localhost:5432/duelo
   REDIS_URL=redis://localhost:6379
   ```

4. Arrancar cada parte en su propia terminal (a medida que cada integrante las vaya creando):

   ```bash
   pnpm dev:api
   ```

   ```bash
   pnpm dev:game
   ```

   ```bash
   pnpm dev:shell
   ```

   Cada remote también corre solo, sin el shell, con una sesión de prueba: `pnpm dev:arena`, `pnpm dev:tienda`, `pnpm dev:ranking`.

### Puertos locales

| Parte | Puerto | Variable para el shell (`apps/shell/.env.local`) |
|---|---|---|
| Shell | 5173 | — |
| Arena | 5174 | `VITE_REMOTE_ARENA_URL=http://localhost:5174` |
| Tienda | 5175 (previsto) | `VITE_REMOTE_TIENDA_URL=http://localhost:5175` |
| Ranking | 5176 | `VITE_REMOTE_RANKING_URL=http://localhost:5176` |
| api | 4000 | `VITE_API_URL=http://localhost:4000` |
| game-server | 3001 | (lo usa la Arena: `VITE_GAME_SERVER_URL`) |

Si el puerto 5432 ya está ocupado en tu PC por otro Postgres, crea un `docker-compose.override.yml` **local** (no lo subas) que publique Postgres en otro puerto y ajusta `DATABASE_URL`:

```yaml
services:
  postgres:
    ports: !override
      - "5433:5432"
```

## API (services/api)

Express 5 + Prisma 7 sobre PostgreSQL, organizada por módulos para que cada uno trabaje en su carpeta:

```text
services/api/src/
├── app.ts           monta los routers de cada módulo
├── config/env.ts    valida las variables de entorno al arrancar
├── lib/             prisma, jwt, HttpError, parseOrThrow (zod)
├── middleware/      requireAuth, requireInternalKey, manejo de errores
└── modules/
    ├── auth/        Felipe: /auth/register, /auth/login, /me
    ├── shop/        Angel: /spells, /me/inventory, /shop/purchase, /me/grimoire, loadout interno
    └── ranking/     Daniel: /ranking, /ranking/me, /me/matches, /internal/matches
```

La primera vez, con `services/api/.env` ya creado, aplica las migraciones (lo mismo que se usa en Render):

```bash
pnpm --filter @duelo/api db:deploy
```

Y carga los hechizos iniciales (sin ellos el registro falla):

```bash
pnpm --filter @duelo/api db:seed
```

- Para cambiar el esquema: editar `prisma/schema.prisma` y crear la migración con `pnpm --filter @duelo/api db:migrate --name <cambio>`.
- Tests: `pnpm --filter @duelo/api test`. Antes de correr, aplican las migraciones y el seed sobre `TEST_DATABASE_URL`, que **debe** ser una base cuyo nombre contenga `test` (las pruebas la vacían). Sin Docker se puede usar la base `duelo_test` de la rama `dev` de Neon (misma cadena que `DATABASE_URL`, cambiando `/neondb` por `/duelo_test`). Las pruebas del ranking también necesitan Redis en `TEST_REDIS_URL` (por defecto `redis://localhost:6379/15`); en el CI de GitHub ya están los dos.
- Todo error responde `{ error: { code, message } }` (`ApiErrorBody` en contracts). Un 401 (`UNAUTHORIZED` o `TOKEN_EXPIRED`) en una ruta que no sea `/auth/*` significa sesión vencida: el frontend emite `duelo:session-expired`.

## Ranking

- **api** (`services/api/src/modules/ranking`): `GET /ranking` (top, público), `GET /ranking/me` y `GET /me/matches` (con JWT), y `POST /internal/matches`, que el game-server llama al terminar cada partida.
  - El cierre de partida va en una transacción: historial, rating (nunca menor que 0), oro y victorias, derrotas y empates.
  - Es idempotente por `matchId`: si el game-server reintenta, no se suman puntos dos veces.
  - Rangos y economía salen de `@duelo/game-rules`.
- **Redis:** `dh:ranking` es una copia rápida que se reconstruye desde PostgreSQL al arrancar el api. Si Redis no responde, el ranking contesta desde PostgreSQL y solo deja un aviso corto en el log.
- **Remote** (`apps/ranking`, puerto 5176): tu posición, el top y tu historial. Se recarga sola con el evento `duelo:match-ended` que emite la Arena. Con un 401 emite `duelo:session-expired`, y mientras Render o Neon despiertan muestra un aviso. Solo (`pnpm dev:ranking`) pide un login real contra el api para obtener la sesión de prueba.

## Scripts de la raíz

| Script | Qué hace |
|---|---|
| `pnpm build` | Compila todos los paquetes que tengan script `build` |
| `pnpm typecheck` | Revisa tipos en todo el monorepo |
| `pnpm test` | Ejecuta las pruebas de todos los paquetes |
| `pnpm build:contracts` | Recompila solo `@duelo/contracts` (hazlo tras cambiar sus tipos) |
| `pnpm dev:<parte>` | `shell`, `arena`, `tienda`, `ranking`, `api`, `game` |
| `pnpm db:up` / `db:down` / `db:logs` | Bases de datos locales con Docker |

Para un solo paquete: `pnpm --filter @duelo/<nombre> <script>`.

## Usar los contratos

```ts
import type { MatchState, ClientToServerEvents, RemoteAppProps } from "@duelo/contracts";
import { emitDueloEvent, onDueloEvent } from "@duelo/contracts";
```

Para usarlo desde una app o servicio, agrega `"@duelo/contracts": "workspace:*"` a sus dependencias (ya está en las 4 apps y los 2 servicios).

## Flujo de trabajo

- `main` protegida: todo entra por PR con 1 aprobación y CI en verde.
- Ramas `feat/<area>-<tema>` o `fix/<area>-<tema>`; commits con Conventional Commits (`feat(arena): reconocer zigzag`).
- Cada integrante sube su propio código.
