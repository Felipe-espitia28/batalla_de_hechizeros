# Traspaso del proyecto "Duelo de hechiceros" (para una cuenta nueva de Claude)

> Estado al **18 de noviembre de 2026**. Este archivo sirve para empezar desde cero en un PC o
> una cuenta de Claude sin historial: crear la carpeta, clonar, instalar, configurar, entender el
> proyecto y retomar la tarea pendiente.

---

## 0. Para la persona (léelo tú primero)

1. Abre Claude Code en cualquier carpeta (puede estar vacía), adjunta o pega este archivo y dile:
   **"Lee este archivo y sigue las instrucciones de la sección 1, paso a paso"**.
2. Ten a mano:
   - El **nombre y correo de tu cuenta de GitHub** (para que tus commits cuenten como tuyos).
   - Acceso a **Bitwarden** del equipo, o pídele a Felipe los valores de las variables de entorno.
     Esos valores los pegas **tú** directamente en los archivos `.env`; no se pegan en el chat.
3. Si al hacer `git push` GitHub te niega el acceso, pídele a Felipe que te agregue como
   colaborador del repositorio.

---

## 1. Instrucciones para Claude Code

Eres el asistente de un integrante del equipo. Sigue estos pasos **en orden**, explicando cada uno
y esperando la confirmación del usuario antes de crear carpetas, instalar o modificar archivos.

### Reglas de trabajo (siempre)

- Responde en **español**. Código: identificadores en inglés, comentarios en español, TypeScript.
- **No hagas commit ni push** sin que el usuario lo pida: el usuario sube su propio código, porque
  la participación en GitHub se evalúa por autor. Dale los comandos.
- **Nunca** escribas, pidas por el chat ni repitas secretos (`DATABASE_URL`, `JWT_SECRET`,
  `INTERNAL_API_KEY`, `REDIS_URL`…). Los `.env.example` solo llevan nombres.
- **Ninguna URL se escribe en el código**: todas salen de variables de entorno.
- No escribas en la base de Neon (compartida) sin aprobación explícita del usuario.
- **No inventes versiones** de librerías: verifica con `npm view <paquete> version`.
- Prueba antes de decir que algo funciona (typecheck, tests, build y ejecución local).
- Trabaja solo en las carpetas del integrante; `packages/contracts` y `packages/game-rules` son
  compartidos: cualquier cambio ahí se propone primero y se avisa al equipo.
- Una vez clonado, **`CLAUDE.md` (raíz del repo) es la fuente de verdad**; si algo de este archivo
  lo contradice, manda CLAUDE.md.

### Paso 1 — Quién eres

Pregunta al usuario:
1. Qué integrante es: Felipe Espitia, Juan Arias, Johan Soriano, Angel Arenales o Daniel Tapiero.
2. Su sistema operativo (Windows, macOS o Linux).

### Paso 2 — Requisitos

Comprueba y reporta:

```bash
git --version
```

```bash
node -v
```

- Node debe ser **22.12 o superior** (el equipo usa 24).
- pnpm se usa con Corepack (viene con Node). La versión exacta (12.18.0) está fijada en el
  `package.json` de la raíz:

```bash
corepack enable
```

  Si falla por permisos en Windows: terminal como administrador, o `npm install -g pnpm@12.18.0`.
  **Es obligatorio que `pnpm -v` responda**: varios scripts (el agente local, la Arena…) llaman a
  `pnpm` por dentro, y con solo `corepack pnpm …` fallan con "pnpm no se reconoce".
- **Chrome o Edge** instalado (el agente local los necesita para la cámara y la voz).
- Docker es **opcional** (solo para Postgres y Redis locales; ver paso 6).

Si falta algo, explica cómo instalarlo y espera a que el usuario confirme.

### Paso 3 — Crear la carpeta y clonar

Propón esta ubicación (el usuario puede elegir otra):

- Windows: `%USERPROFILE%\Proyectos\duelo-de-hechiceros`
- macOS / Linux: `~/Proyectos/duelo-de-hechiceros`

Si la carpeta ya existe, pregunta antes de tocarla. Luego:

```bash
mkdir -p ~/Proyectos
```

(En PowerShell: `New-Item -ItemType Directory -Force "$env:USERPROFILE\Proyectos"`.)

```bash
cd ~/Proyectos
```

```bash
git clone https://github.com/Felipe-espitia28/batalla_de_hechizeros.git duelo-de-hechiceros
```

```bash
cd duelo-de-hechiceros
```

A partir de aquí, **trabaja dentro de `duelo-de-hechiceros`** y lee `CLAUDE.md` completo.

### Paso 4 — Identidad de git (solo en este repo)

Pregunta el nombre y el correo **de la cuenta de GitHub** del usuario (no los adivines) y
configúralos localmente:

```bash
git config user.name "<Nombre Apellido>"
```

```bash
git config user.email "<correo de GitHub>"
```

### Paso 5 — Instalar dependencias

```bash
corepack pnpm install
```

El `postinstall` compila `@duelo/contracts` y `@duelo/game-rules` y genera el cliente de Prisma.

### Paso 6 — Variables de entorno

Copia cada ejemplo a su archivo local (estos archivos están en `.gitignore`):

| Ejemplo | Copiar a |
|---|---|
| `services/api/.env.example` | `services/api/.env` |
| `services/game-server/.env.example` | `services/game-server/.env` |
| `apps/shell/.env.example` | `apps/shell/.env.local` |
| `apps/arena/.env.example` | `apps/arena/.env.local` |
| `apps/tienda/.env.example` | `apps/tienda/.env.local` |
| `apps/ranking/.env.example` | `apps/ranking/.env.local` |
| `apps/local-agent/.env.example` | `apps/local-agent/.env` |

Valores locales que **no son secretos** (puedes escribirlos tú):

| Archivo | Valores |
|---|---|
| `apps/shell/.env.local` | `VITE_API_URL=http://localhost:4000`, `VITE_REMOTE_ARENA_URL=http://localhost:5174`, `VITE_REMOTE_TIENDA_URL=http://localhost:5175`, `VITE_REMOTE_RANKING_URL=http://localhost:5176` |
| `apps/arena/.env.local` | `VITE_API_URL=http://localhost:4000`, `VITE_GAME_SERVER_URL=http://localhost:3001`, `VITE_LOCAL_AGENT_URL=ws://127.0.0.1:47800/events` |
| `apps/tienda/.env.local`, `apps/ranking/.env.local` | `VITE_API_URL=http://localhost:4000` |
| `apps/local-agent/.env` | `AGENT_PORT=47800`, `ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174` (el shell es obligatorio: dentro de él, el Origin es el del shell), `AGENT_OPEN_BROWSER=` (vacío = abre Chrome) |
| `services/api/.env` | `PORT=4000`, `ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176` |
| `services/game-server/.env` | `PORT=3001`, `ALLOWED_ORIGINS=` igual que el api |

Secretos (`JWT_SECRET`, `INTERNAL_API_KEY`, y `DATABASE_URL`/`REDIS_URL` si se usa la nube): el
usuario los pega desde Bitwarden. `JWT_SECRET` e `INTERNAL_API_KEY` deben ser **iguales** en el api
y en el game-server.

Bases de datos, según lo que tenga el usuario:

- **Con Docker:** `corepack pnpm db:up` levanta Postgres (5432) y Redis (6379). Valores locales:
  `DATABASE_URL=postgresql://duelo:duelo@localhost:5432/duelo` y `REDIS_URL=redis://localhost:6379`.
  Después: `corepack pnpm --filter @duelo/api db:migrate` y `corepack pnpm --filter @duelo/api db:seed`.
- **Sin Docker:** el api usa la `DATABASE_URL` de Neon dev (de Bitwarden). Avisa al usuario de que
  esa base es **compartida**: no corras migraciones, seeds ni `db:demo-gold` sin su aprobación.
  El **game-server funciona sin `REDIS_URL` ni `API_INTERNAL_URL`** (cola en memoria y api simulado).

### Paso 7 — Verificar que todo funciona

```bash
corepack pnpm typecheck
```

Pruebas del área del usuario (por ejemplo):

```bash
corepack pnpm --filter @duelo/local-agent test
```

Agente local (debe abrir una ventana de Chrome/Edge; en otra terminal, `http://127.0.0.1:47800/health`
debe responder `{"ok":true,...}`):

```bash
corepack pnpm --filter @duelo/local-agent start
```

Reporta qué pasó y qué falló, con el error real.

### Paso 8 — Retomar la tarea

1. Lee `docs/plan-agente-local.md` y, en `docs/prompts-agente-local.md`, la sección del integrante.
   Si ese archivo aún no está en `main`, usa la tabla de la sección 3 de este documento.
2. Resume al usuario su tarea, la rama que debe crear y los archivos que puede tocar, y pregunta si
   empiezas. Rama desde `main` actualizado:

```bash
git checkout main
```

```bash
git pull
```

```bash
git checkout -b <rama-de-la-tabla>
```

---

## 2. Resumen del proyecto

### Qué es

Juego web 1 contra 1 en tiempo real. Cada jugador está frente a su cámara y lanza hechizos
**dibujando gestos con la mano** (pinza pulgar–índice para dibujar; MediaPipe detecta la mano en su
propio PC). Para lanzar un **definitivo** grita su nombre al micrófono. Los dos jugadores combaten
por WebSocket contra un servidor autoritativo.

- Curso: Arquitectura de Software, Ingeniería de Sistemas, sexto semestre.
- Entrega: 17 nov 2026. Solo capas gratuitas de nube.

### Requisitos que evalúa el profesor

| Req. | Requisito | Cómo se cumple |
|---|---|---|
| R1 | Desplegado en la nube | 4 frontends en Vercel, `api` y `game-server` en Render, PostgreSQL en Neon, Redis en Upstash |
| R2 | Módulo local | `apps/local-agent`: programa en el PC del jugador (servidor en 127.0.0.1 + ventana del detector con `packages/spell-engine`: MediaPipe, reconocedor $1 y voz). A la Arena solo le pasa eventos `{ spellId, confidence }` |
| R3 | Sockets | `services/game-server` con Socket.IO |
| R4 | Cámara y micrófono | Gestos (cámara) y grito del definitivo (micrófono) |
| R5 | 2 bases de datos | PostgreSQL (permanente) + Redis (cola, partidas en vivo, ranking) |
| R6 | 100 % en GitHub | Monorepo, PRs revisados, GitHub Actions en verde |
| R7 | Micro frontends | Shell + 3 remotes (Arena, Tienda, Ranking) con Module Federation y despliegue independiente |

Nunca se envía video ni audio al servidor: solo eventos ya procesados.

### Stack

React + Vite + TypeScript · Module Federation (`@module-federation/vite`) · MediaPipe Tasks Vision
(`HandLandmarker`) + reconocedor $1 propio · Web Audio + Web Speech · Node + Express (`api`) ·
Node + Socket.IO (`game-server`) · Prisma · JWT propio (el mismo token para REST y socket) ·
pnpm workspaces · GitHub Actions · `ws` (WebSocket del agente local).

### Arquitectura (resumen)

```text
PC del jugador
  Agente local (apps/local-agent, 127.0.0.1:47800)
    Ventana del detector: cámara → MediaPipe → reconocedor (X dos manos / línea / $1)
                          micrófono → volumen + Web Speech
    Servidor local: WebSocket /events  ──(spellId + confidence)──▶  Arena
  Shell (login, sesión, navegación) ──Module Federation──▶ Arena, Tienda, Ranking

Nube
  Arena ──WSS + JWT──▶ game-server (autoritativo, partida en memoria, tick 100 ms) ──▶ Redis
  Shell/Tienda/Ranking ──HTTPS + JWT──▶ api (Express) ──▶ PostgreSQL + Redis
  game-server ──/internal (x-internal-key)──▶ api: loadout del jugador y resultado de la partida
```

Principios: el servidor decide todo (el cliente solo dice "lancé X"); los números de balance viven
en `packages/game-rules`; una sola instancia del game-server; comunicación entre micro frontends
solo por props (`session`, `navigate`) y `CustomEvent` `duelo:*`, sin estado global.

### Estructura del repo

```text
apps/shell        Felipe   Host de Module Federation, login, navegación
apps/arena        Juan     Remote: calibración, entrenamiento, búsqueda, duelo, resultado
apps/tienda       Angel    Remote: catálogo, compra, grimorio
apps/ranking      Daniel   Remote: ranking e historial
apps/local-agent  (R2)     Agente local; no se despliega
services/api               Express + Prisma: auth (Felipe), tienda (Angel), ranking (Daniel)
services/game-server Johan Socket.IO: matchmaking, combate, reconexión, abandono
packages/contracts         Tipos compartidos: socket, REST, CustomEvents, protocolo agent:*
packages/game-rules        Catálogo, balance, rangos, economía
packages/spell-engine Juan Módulo local: MediaPipe, $1, línea recta, X, voz
docs/                      Planes, prompts, guion, despliegue
.github/                   CI, CODEOWNERS, plantilla de PR
```

### Equipo

| Integrante | Claude Pro | Área |
|---|---|---|
| Felipe Espitia | Sí | Plataforma e integración: shell, Module Federation, auth, CI, despliegues |
| Juan Arias | Sí | Módulo local (`spell-engine`) y Arena |
| Johan Soriano | Sí | Tiempo real: `game-server` |
| Angel Arenales | Sí (desde el 18 nov) | Tienda, `packages/ui` |
| Daniel Tapiero | Sí (desde el 19 nov) | Ranking, README y guion |

Desde el 11 nov Felipe puede cubrir huecos de otras áreas, avisándolo en el PR.

### Reglas del juego (detalle completo en CLAUDE.md §6)

- 90 s, 100 de vida, maná 30 → 100 (+4/s). Calibración de cámara y cuenta 3-2-1.
- Confianza mínima 0,80; por debajo, "¡Hechizo fallido!".
- Grimorio: 4 espacios (Rayo y Escudo fijos) + 1 definitivo (Meteoro por defecto).
- Hechizos: Rayo (zigzag, 10), Escudo (círculo), Corte (línea, 5), Bola de fuego (triángulo, 15 +
  quemadura), Curación (V, +15), Veneno (S), Congelar (cuadrado), Sello de silencio (X con dos manos).
- Definitivos (100 de maná, gritando): Meteoro, Tormenta, Renacer, Vacío púrpura.
- Economía: victoria +25 puntos/+50 oro; derrota −15 (nunca bajo 0)/+20; empate 0/+30.

---

## 3. Estado al 18 nov 2026

- La entrega fue el 17 nov. Todo P0 y P1 está en `main` y desplegado; la Arena, la Tienda y la
  búsqueda/duelo/resultado tienen el diseño de Figma.
- **Comentario del profesor:** "no hay local" (no se veía el módulo local como algo aparte) y
  micro frontends. Los micro frontends ya cumplen (carga en tiempo de ejecución desde 4 despliegues);
  el módulo local se está mejorando con el **agente local**.
- **Fase 1 (Felipe, PR #30, en `main`):** protocolo `agent:*` en
  `packages/contracts/src/local-agent.ts`; `apps/local-agent` con configuración, servidor HTTP en
  127.0.0.1 (sirve el detector y MediaPipe, responde `/health`), lanzador de Chrome/Edge en modo app
  y 18 pruebas.
- **Fase 2 (en curso, en paralelo):**

| Integrante | Rama | Tarea |
|---|---|---|
| Johan | `feat/agente-local-servidor` | WebSocket en `apps/local-agent/src/server.ts`: validar `Origin`, `agent:hello`, un detector y una arena, reenvío según `LOCAL_AGENT_SENDERS`, `agent:peer`, ping cada 10 s, logs `[agente]`, pruebas |
| Juan | `feat/agente-local-detector` | `detector/main.ts` (SpellEngine + VoiceListener → mensajes), `LocalAgentSource` en `spell-engine` con error `AGENT_NOT_RUNNING`, y en la Arena usar el agente por defecto sin abrir cámara ni micrófono (integra cuando el servidor de Johan esté en `main`) |
| Angel | `feat/agente-local-ui` | `detector/index.html` + `styles.css` con los IDs `#camera-video`, `#camera-canvas`, `#status`, `#arena-status`, `#mic-status`, `#mic-meter`, `#event-log`; componente `apps/arena/src/ui/agent-panel.tsx` (estados `connecting`, `connected`, `detector-closed`, `not-found`, `camera-error`) |
| Daniel | `docs/agente-local` | Sección "Agente local (R2)" del README, `docs/guion-agente-local.md` y `docs/pruebas-agente-local.md` |
| Felipe | — | `VITE_LOCAL_AGENT_URL` en Vercel (Arena), revisar PRs, ensayo en dos PCs |

- **Pendientes generales:** probar con cámara y micrófono reales en dos PCs; delegar el DNS de
  `duelohechiceros.qd.je` a `ns1/ns2.magicsolutions.co`; ruleset de `main` con "Require status checks".

---

## 4. Comandos, puertos y variables

### Puertos locales

| Parte | Puerto | Comando |
|---|---|---|
| Shell | 5173 | `corepack pnpm dev:shell` |
| Arena | 5174 | `corepack pnpm dev:arena` |
| Tienda | 5175 | `corepack pnpm dev:tienda` |
| Ranking | 5176 | `corepack pnpm dev:ranking` |
| api | 4000 | `corepack pnpm dev:api` |
| game-server | 3001 | `corepack pnpm dev:game` |
| Agente local | 47800 | `corepack pnpm --filter @duelo/local-agent start` |

Cada remote corre solo, sin el shell, con una sesión de prueba (un JWT real del api, o
`dev:<usuario>` contra el game-server simulado). En la Arena, `?teclado` en la URL (solo en
desarrollo) permite lanzar hechizos con las teclas 1–4 y 9 sin cámara.

### Comandos útiles

| Qué | Comando |
|---|---|
| Revisar tipos de todo | `corepack pnpm typecheck` |
| Probar todo | `corepack pnpm test` |
| Compilar todo | `corepack pnpm build` |
| Un paquete | `corepack pnpm --filter @duelo/<paquete> <typecheck\|test\|build>` |
| Migrar / seed (base local) | `corepack pnpm --filter @duelo/api db:migrate` / `db:seed` |
| Bases con Docker | `corepack pnpm db:up` / `db:down` |

### Variables de entorno (solo nombres; valores en Bitwarden)

| Variable | Dónde |
|---|---|
| `DATABASE_URL` | api |
| `REDIS_URL` | api, game-server |
| `JWT_SECRET`, `INTERNAL_API_KEY` | api, game-server (iguales en ambos) |
| `API_INTERNAL_URL` | game-server |
| `ALLOWED_ORIGINS` | api, game-server, local-agent |
| `AGENT_PORT`, `AGENT_OPEN_BROWSER` | local-agent |
| `VITE_API_URL`, `VITE_GAME_SERVER_URL` | shell, arena, tienda, ranking (según usen) |
| `VITE_LOCAL_AGENT_URL` | arena |
| `VITE_REMOTE_ARENA_URL`, `VITE_REMOTE_TIENDA_URL`, `VITE_REMOTE_RANKING_URL` | shell |

---

## 5. Flujo de trabajo

1. Rama desde `main` actualizado: `feat/area-tema`, `fix/area-tema` o `docs/tema`.
2. Commits pequeños con *Conventional Commits*: `feat(arena): …`, `fix(game-server): …`.
3. PR a `main` con **1 aprobación** de otro integrante y el check **"CI / verificar"** en verde
   (revisa tipos, compila y prueba solo lo afectado; ver `.github/workflows/ci.yml`).
4. Cada integrante sube su propio código desde su cuenta de GitHub.
5. Cambios en `packages/contracts` o `packages/game-rules`: avisar al equipo antes.

---

## 6. Problemas conocidos

| Síntoma | Solución |
|---|---|
| `pnpm` no se reconoce | Usar `corepack pnpm …` |
| Error de Vite "Cannot read properties of undefined (reading 'd')" en un remote | Parar el remote, borrar su `node_modules/.vite` y arrancarlo de nuevo |
| Imágenes de un remote dan 404 dentro del shell | Cargarlas con `UI_ASSETS_PATH` (origen del remote) en un `<img>`, nunca con `url()` relativo en el CSS |
| La primera petición tarda ~1 min | Render free se duerme tras 15 min y Neon se suspende tras 5 min; despertarlos antes de una demo |
| "La cámara está ocupada" | Cerrar Zoom/Meet/Teams u otra pestaña que la use; en modo agente solo el agente abre la cámara |
| "El puerto 47800 ya está en uso" | Hay otro agente abierto: cerrarlo o cambiar `AGENT_PORT` y `VITE_LOCAL_AGENT_URL` |
| Chrome pregunta si la página puede acceder a la red local | Permitirlo: la Arena se conecta al agente en 127.0.0.1 |
| El agente rechaza la Arena: "conexión rechazada desde http://localhost:5173" (403) | Falta el shell en `ALLOWED_ORIGINS` de `apps/local-agent/.env`: dentro del shell el Origin es el del shell. Agregar `http://localhost:5173` (y la URL de Vercel del shell) y reiniciar el agente |
| Faltan variables de entorno al arrancar | El mensaje dice cuáles; copiar el `.env.example` correspondiente y rellenarlo |

---

## 7. Contacto

**Felipe Espitia** (plataforma e integración): valores de Bitwarden, acceso a Vercel y Render,
acceso de colaborador en GitHub y revisión de PRs.
