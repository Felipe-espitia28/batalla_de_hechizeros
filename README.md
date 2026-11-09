# Duelo de hechiceros

Juego web 1 contra 1 en tiempo real: cada jugador lanza hechizos dibujando gestos frente a su cámara (MediaPipe corre en su propio PC) y activa los definitivos gritando su nombre. Proyecto final de Arquitectura de Software.

El diseño completo (requisitos R1–R7, arquitectura, reglas del juego, contratos y despliegue) está en [CLAUDE.md](CLAUDE.md). Es la fuente de verdad.

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
- Tests: `pnpm --filter @duelo/api test`. Los de integración necesitan `TEST_DATABASE_URL` (una base con migraciones y seed); sin ella se omiten.
- Todo error responde `{ error: { code, message } }` (`ApiErrorBody` en contracts). Un 401 (`UNAUTHORIZED` o `TOKEN_EXPIRED`) en una ruta que no sea `/auth/*` significa sesión vencida: el frontend emite `duelo:session-expired`.

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
