# Plan: agente local de hechizos (mejora de R2), repartido por integrante

## Contexto

El profesor comentó "No hay local". Hoy `packages/spell-engine` (MediaPipe, $1, la X, la voz) sí corre en el PC del jugador, pero va empaquetado dentro de la Arena y se descarga de Vercel con la página: no se ve como un módulo local aparte. Los micro frontends ya están bien y no se tocan.

**Objetivo:** un **agente local**, un programa que el jugador ejecuta en su PC y que se ve en el Administrador de tareas. Hace todo el reconocimiento con la cámara y el micrófono y le pasa a la Arena solo los eventos `{ spellId, confidence }` por `127.0.0.1`. Sin el agente, la Arena pide abrirlo.

**Ya está preparado para esto:** `SpellSource` (`packages/spell-engine/src/spell-source.ts`) y `SpellEngineHandlers` (`events.ts`) se escribieron pensando en "un agente local externo". La Arena solo depende de esa interfaz, así que el agente es una fuente más, como `KeyboardSpellSource`.

## Diseño

```
PC del jugador
┌───────────────────────────────────────────┐
│ Agente local (Node, 127.0.0.1:AGENT_PORT) │
│  ├─ sirve la página del detector           │
│  └─ WebSocket /events: reenvía mensajes    │
│        ▲ detector            ▼ arena       │
│ Ventana del detector (Chrome --app,        │
│ http://localhost): cámara + MediaPipe +    │
│ $1 + voz, con SpellEngine y VoiceListener  │
└───────────────────────────────────────────┘
          ▲ ws://127.0.0.1 (solo eventos)
Arena (https, Vercel) → LocalAgentSource → game-server
```

- **Por qué Node más una ventana de Chrome y no Electron:** MediaPipe Tasks Vision necesita un navegador, y Web Speech (los definitivos) no funciona en Electron. Chrome sí lo soporta, y `http://localhost` cuenta como contexto seguro, así que la cámara abre sin HTTPS. Se reutiliza el `spell-engine` sin cambiarlo.
- **La cámara la abre solo el agente.** En modo agente, la Arena no abre la cámara y en su lugar muestra el estado que le llega: conectado, mano visible y último hechizo. En Windows, dos aplicaciones con la misma webcam dan `CAMERA_IN_USE`.
- **Se conserva el motor dentro del navegador** como respaldo ("Usar la cámara del navegador") y el `?teclado` de desarrollo.
- **Sin URLs en el código:**
  - la Arena lee `VITE_LOCAL_AGENT_URL`;
  - el agente lee `AGENT_PORT` y `ALLOWED_ORIGINS` (los orígenes del shell y de la Arena sola: dentro del shell el navegador manda el Origin del shell);
  - se agregan a los `.env.example` solo con los nombres.
- **Seguridad:**
  - el servidor escucha solo en `127.0.0.1`, lo que además evita el aviso del firewall de Windows;
  - rechaza cualquier WebSocket cuyo `Origin` no esté en `ALLOWED_ORIGINS`;
  - nunca viaja video ni audio, solo eventos.

### Protocolo (nuevo `packages/contracts/src/local-agent.ts`)

Todos los mensajes llevan `{ type, ... }`. Al conectarse, cada cliente manda `agent:hello` con `role: "detector" | "arena"` y `protocolVersion`. Los tipos ya están en `packages/contracts/src/local-agent.ts`, con `parseLocalAgentMessage` y `LOCAL_AGENT_SENDERS` (quién puede mandar cada mensaje).

| Dirección | type | Payload |
|---|---|---|
| arena → detector | `agent:config` | `{ grimoire, ultimateId, minConfidence }` |
| detector → arena | `agent:status` | `{ camera: "loading" \| "ready" \| "error", handVisible, micReady }` |
| detector → arena | `agent:spell` | `SpellEvent` |
| detector → arena | `agent:spell-failed` | `SpellFailedEvent` |
| detector → arena | `agent:ultimate` | `UltimateEvent` |
| detector → arena | `agent:seal-charging` / `agent:seal-cancel` | `{}` |
| detector → arena | `agent:error` | `SpellEngineError` sin `cause` |
| servidor → ambos | `agent:peer` | `{ detector: boolean, arena: boolean }` |

Antes de escribir código, verifiquen con `npm view ws version` la versión de `ws` y la de cualquier otra dependencia que agreguen. No se inventan versiones.

## Reparto

### Felipe (plataforma): base del proyecto. Va primero porque los demás dependen de esto.

Rama `feat/agente-local-base`.

1. Escribir `packages/contracts/src/local-agent.ts` con los tipos de la tabla y exportarlo. Es compartido, así que hay que avisar al equipo.
2. Crear el esqueleto de `apps/local-agent` (`@duelo/local-agent`, que no se despliega en Vercel):
   - `package.json` con los scripts `dev`, `build`, `start` y `test`;
   - `tsconfig.json`;
   - `.env.example` con `AGENT_PORT` y `ALLOWED_ORIGINS`;
   - `src/server.ts` con el servidor HTTP en 127.0.0.1: ya sirve el detector y MediaPipe y responde `/health` (hecho en la fase 1); falta el WebSocket;
   - el script `assets`, que reutiliza `packages/spell-engine/scripts/copy-assets.mjs` para servir el `.wasm` y el modelo desde el propio agente, así funciona sin internet.
3. `src/launcher.ts`: cuando el servidor está listo, abre Chrome en modo app con la URL del detector. Si no encuentra Chrome, imprime la URL para abrirla a mano.
4. CI: agregar el typecheck y los tests de `@duelo/local-agent` a `.github/workflows/ci.yml`.
5. Agregar `VITE_LOCAL_AGENT_URL` a `apps/arena/.env.example` y a Vercel (proyecto arena), y los orígenes del shell y de la Arena desplegados a la documentación de `ALLOWED_ORIGINS`.
6. Actualizar el diagrama y la fila de R2 en CLAUDE.md.
7. Revisar e integrar los PRs de los demás.

### Johan (tiempo real): el servidor del agente

Rama `feat/agente-local-servidor`, en `apps/local-agent/src/server.ts`.

1. Ya hecho en la fase 1 (`src/server.ts`): el servidor `node:http` en `127.0.0.1:AGENT_PORT` que
   - sirve el build del detector y los archivos de MediaPipe;
   - responde `GET /health` con `{ ok, detector, arena }` (Johan actualiza `status` cuando entra o sale cada rol).
2. Un WebSocket en `/events` con `ws`:
   - valida el `Origin` contra `ALLOWED_ORIGINS` y el propio origen del detector (`detectorUrl` de `src/config.ts`, 127.0.0.1);
   - `ws` 8.23.0 y `@types/ws` 8.18.2 ya están en el `package.json` (verificados con `npm view`);
   - registra el rol que llega en `hello`, con máximo un detector y una arena (la conexión nueva reemplaza a la anterior);
   - reenvía los mensajes del detector a la arena y los de la arena al detector, y avisa con `agent:peer` cuando alguien entra o sale;
   - hace un ping cada 10 s y cierra los sockets que no respondan.
3. Un log en consola de cada evento reenviado (`[agente] lightning 0.91`): sirve para mostrárselo al profesor.
4. Tests con vitest: rechazo de un origen no permitido, reenvío detector → arena y reemplazo de una conexión.

### Juan (módulo local y Arena): el detector y la integración

Rama `feat/agente-local-detector`.

1. **El detector** (`apps/local-agent/detector/main.ts`, con Vite y sin React):
   - crea `SpellEngine` y `VoiceListener` de `@duelo/spell-engine` igual que `apps/arena/src/engine/use-spell-source.ts` y `use-voice.ts` (dibuja la estela con `drawStroke`/`drawSeal`);
   - se conecta al WebSocket del mismo origen, manda `agent:hello`, aplica `agent:config` con `setGrimoire` y reenvía cada handler como mensaje;
   - manda `agent:status` cuando cambia la mano visible, sin enviarlo en cada fotograma.
2. **La nueva fuente** `LocalAgentSource implements SpellSource`, en `packages/spell-engine/src/local-agent-source.ts`, exportada en `index.ts`:
   - `start()` conecta a `VITE_LOCAL_AGENT_URL` (que recibe por opción, no la lee él) y devuelve `false` con un error nuevo, `AGENT_NOT_RUNNING`, si no conecta;
   - `setGrimoire` manda `agent:config`;
   - reintenta la conexión si se cae;
   - el nuevo código `AGENT_NOT_RUNNING` va en `events.ts` con su mensaje en español.
3. **Integración en la Arena:**
   - `use-spell-source.ts` usa `LocalAgentSource` por defecto, `SpellEngine` si el jugador elige "Usar la cámara del navegador" y el teclado con `?teclado`;
   - `handVisible` sale de `agent:status`;
   - en la calibración y el duelo, el espacio de la cámara muestra el panel del agente (de Angel) en vez del `<video>`.
4. **Tests:** `LocalAgentSource` con un WebSocket falso (conecta, reenvía, error si no hay agente).

### Angel (UI): cómo se ve el agente

Rama `feat/agente-local-ui`, usando los colores de la Arena y los estilos de `packages/ui`.

1. El HTML y el CSS de la ventana del detector (`apps/local-agent/detector/index.html` y `styles.css`):
   - la cámara con la estela;
   - el estado de la Arena (conectada o esperando) y del micrófono;
   - la lista de los últimos 10 eventos enviados con su confianza;
   - la leyenda "Todo se procesa en este PC".
2. Un componente `AgentPanel` en la Arena (`apps/arena/src/ui/agent-panel.tsx`) para el espacio de la cámara. Tiene tres estados:
   - **conectado:** mano visible y último hechizo;
   - **no encontrado:** instrucciones para abrirlo, un botón "Reintentar" y otro "Usar la cámara del navegador";
   - **error de cámara:** el mensaje que manda el agente.

   Juan lo conecta a los datos.

### Daniel (documentación y guion): cómo se instala y cómo se demuestra

Rama `docs/agente-local`.

1. Una sección "Agente local" en el README:
   - requisitos (Node y Chrome);
   - cómo instalarlo y abrirlo (`pnpm install`, `pnpm --filter @duelo/local-agent start`);
   - el `.env` con los nombres de las variables;
   - los problemas comunes: puerto ocupado, Chrome que pide permiso de red local y cámara en uso.
2. El guion de la demo de R2, en `docs/`:
   1. mostrar el proceso `node` del agente en el Administrador de tareas;
   2. en DevTools de la Arena, mostrar que solo hay mensajes pequeños por `ws://127.0.0.1` y nada de video;
   3. cerrar el agente: la Arena pide abrirlo;
   4. desconectar internet: la ventana del detector sigue reconociendo gestos (sin internet solo fallan la partida y los definitivos por voz).
3. Una lista de pruebas manuales para los dos PCs, que se marcan en el ensayo.

## Orden y tiempos

| Fase | Quién | Qué | Bloquea |
|---|---|---|---|
| 1 (≈2 h) | Felipe | Contratos y esqueleto de `apps/local-agent`, fusionados a `main` | Todo lo demás |
| 2 (en paralelo, ≈medio día) | Johan, Juan, Angel, Daniel | Servidor, detector y `LocalAgentSource`, UI, documentación | — |
| 3 (≈2 h) | Juan y Felipe | Integrar en la Arena, `AgentPanel` y pruebas locales | Fase 2 |
| 4 (≈1 h) | Todos | Partida en dos PCs con el agente y ensayo del guion | Fase 3 |

Cada uno sube su propio código y abre su propio PR, como pide CLAUDE.md. Los prompts de cada uno están en `docs/prompts-agente-local.md` (todos con Claude Code).

## Riesgos

- **Permiso de red local:** las versiones recientes de Chrome pueden pedir permiso para que una página pública (la Arena en Vercel) se conecte a `127.0.0.1`. El jugador lo acepta una vez. Hay que probarlo en los dos PCs antes del ensayo, y el respaldo es "Usar la cámara del navegador".
- **Dos ventanas en pantalla:** la cámara queda en la ventana del agente, no en la Arena. Para la demo se ponen lado a lado; a cambio, el módulo local se ve claramente.
- **Cambia `packages/contracts`:** hay que avisar a todos.
- **R2 y el resto de requisitos no se pierden:** el motor dentro del navegador sigue como respaldo, y el socket con el game-server no cambia.

## Verificación

1. Tests de `@duelo/local-agent`, `@duelo/spell-engine` y `@duelo/arena`, más el typecheck y el build, en verde en el CI.
2. Prueba en local:
   1. `pnpm --filter @duelo/local-agent start` abre la ventana del detector;
   2. la Arena (5174) muestra "Agente conectado";
   3. al dibujar el zigzag, la consola del agente muestra `lightning`, la Arena lo envía al game-server y baja la vida del rival.
3. Cerrar el agente con la Arena abierta: aparece "Agente no encontrado" y, al reabrirlo, se reconecta sola.
4. Desde un origen que no está en `ALLOWED_ORIGINS`, la conexión se rechaza.
5. Una partida real en dos PCs con la Arena desplegada, siguiendo el guion de Daniel.

## Instalar el agente sin el repo (jugadores)

Para jugar no hace falta clonar el repo ni pnpm: solo **Node 22 o superior** y Chrome o Edge.

1. Descargar `agente-local-windows.zip` de la página de Releases del repositorio (o del botón
   "Descargar el agente" de la Arena, que usa `VITE_LOCAL_AGENT_DOWNLOAD_URL`).
2. Descomprimir y hacer doble clic en `Iniciar agente.bat`: comprueba Node, arranca el agente y abre
   la ventana del detector.
3. Permitir cámara y micrófono y entrar al juego.

Cómo se publica (Felipe):

- `pnpm --filter @duelo/local-agent package` arma `apps/local-agent/release/agente-local/`:
  `agente.mjs` (agente y dependencias en un solo archivo, con esbuild), `detector/` (con MediaPipe),
  `.env` (puerto, `ALLOWED_ORIGINS` de `RELEASE_ALLOWED_ORIGINS`, `AGENT_DETECTOR_DIR=detector`),
  `Iniciar agente.bat` y `LEEME.txt`.
- `.github/workflows/agente-local-release.yml` lo comprime y lo publica en Releases con cada tag
  `agente-v*` (o a mano). Necesita la variable del repositorio `AGENT_ALLOWED_ORIGINS`.
