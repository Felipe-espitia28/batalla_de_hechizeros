# Despliegue

Guía para desplegar el proyecto en la nube (R1) con capas gratuitas. Los **valores** de las variables viven en Bitwarden; aquí solo van los nombres.

**Orden:** secretos → Neon → Upstash → Render (api y luego game-server) → Vercel (remotes y luego el shell). Cada paso necesita las URLs del anterior.

Los nombres de ejemplo de este documento (`duelo-api`, `duelo-shell`…) definen las URLs. Si una plataforma añade un sufijo porque el nombre está ocupado, usa la URL real en todos los lugares donde aparezca.

## 0. Secretos

Para producción se generan secretos nuevos; nunca se reutilizan los de desarrollo:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Uno es `JWT_SECRET` y el otro `INTERNAL_API_KEY`. El api y el game-server usan **los mismos** dos.

## 1. Neon (PostgreSQL)

- En la rama `production` se usa la URL **sin pooling** y con `sslmode=verify-full`. Es `DATABASE_URL`.
- No hay que migrar a mano: el build del api en Render aplica las migraciones y el seed del catálogo. Las dos operaciones son seguras de repetir.

## 2. Upstash (Redis)

Una base en la región `us-east-1`. Su URL `rediss://…` es `REDIS_URL`.

## 3. Render: api

Es un Web Service sobre la raíz del monorepo, en la región Virginia y en el plan Free.

| Campo | Valor |
|---|---|
| Build Command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @duelo/api build && pnpm --filter @duelo/api db:deploy && pnpm --filter @duelo/api db:seed` |
| Start Command | `pnpm --filter @duelo/api start` |
| Health Check Path | `/health` |

| Variable | Valor |
|---|---|
| `NODE_VERSION` | `24` |
| `COREPACK_ENABLE_DOWNLOAD_PROMPT` | `0` |
| `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `INTERNAL_API_KEY` | Bitwarden |
| `ALLOWED_ORIGINS` | Las 4 URLs de Vercel separadas por comas, sin `/` final |

No se define `NODE_ENV=production`: pnpm omitiría las devDependencies (TypeScript, la CLI de Prisma, tsx) y el build fallaría.

## 4. Render: game-server

Es igual que el api, con estos cambios (más detalle en `services/game-server/README.md`):

| Campo | Valor |
|---|---|
| Build Command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @duelo/game-server build` |
| Start Command | `pnpm --filter @duelo/game-server start` |
| Health Check Path | `/health` |

| Variable | Valor |
|---|---|
| `NODE_VERSION`, `COREPACK_ENABLE_DOWNLOAD_PROMPT` | Igual que el api |
| `REDIS_URL`, `JWT_SECRET`, `INTERNAL_API_KEY` | Los mismos que el api |
| `API_INTERNAL_URL` | URL pública del api |
| `ALLOWED_ORIGINS` | URL del shell y de la Arena |

## 5. Vercel: un proyecto por app

Primero van los 3 remotes y al final el shell, porque el shell necesita las URLs de los remotes. En cada proyecto:

| Campo | Valor |
|---|---|
| Root Directory | `apps/arena`, `apps/tienda`, `apps/ranking` o `apps/shell` |
| Framework | Vite |
| Build Command | `pnpm run build` |
| Output Directory | `dist` |
| Settings → Git | Activar "Skip deployments when there are no changes to the root directory or its dependencies" (despliegue independiente, R7) |

| Variable | Proyectos |
|---|---|
| `ENABLE_EXPERIMENTAL_COREPACK=1` | Todos (para usar el pnpm de `packageManager`) |
| `VITE_API_URL` | Todos |
| `VITE_GAME_SERVER_URL` | Arena |
| `VITE_REMOTE_ARENA_URL`, `VITE_REMOTE_TIENDA_URL`, `VITE_REMOTE_RANKING_URL` | Shell |

- Las `VITE_*` se fijan en el build: si cambias una, hay que hacer **Redeploy**.
- Cada app compila `@duelo/contracts` y `@duelo/game-rules` en su propio `build` (`build:deps`), así que no depende del `postinstall` de la raíz.
- Los remotes sirven `remoteEntry.js` y `assets/` con CORS abierto (`vercel.json`). `remoteEntry.js` va sin caché para que un redespliegue se vea al instante.

## 6. Comprobaciones

1. `https://<api>/health` y `https://<game-server>/health` responden `{"ok":true}`.
2. `https://<remote>/remoteEntry.js` descarga JavaScript.
3. En el shell funcionan el registro, la tienda, el ranking y una partida en dos navegadores.
4. Durante la partida aparecen claves `dh:` en Upstash (Data Browser), y en Neon production hay filas en `users` y `matches` (R5).

Si cambian las URLs, se actualiza `ALLOWED_ORIGINS` en Render y se hace **Manual Deploy**.

## Calendario

- Despliegue completo: 12 nov.
- DNS en el panel de magicsolutions: antes del 14 nov.
- **Sin cambios de infraestructura desde el 15 nov.**
