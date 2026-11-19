# Prompts de la fase 2 del agente local (R2)

La fase 1 (`feat/agente-local-base`) ya está en `main`: el protocolo `agent:*` en `packages/contracts/src/local-agent.ts` y `apps/local-agent` con su configuración, el servidor HTTP en 127.0.0.1 (sirve el detector y MediaPipe y responde `/health`), el lanzador de Chrome y 18 pruebas. El plan completo está en `docs/plan-agente-local.md`.

## Acuerdos entre prompts (para que las ramas no choquen)

**IDs del DOM de la ventana del detector.** Angel escribe `detector/index.html` y `detector/styles.css`; Juan solo escribe `detector/main.ts` y usa estos IDs:

| ID | Elemento |
|---|---|
| `#camera-video` | `<video>` |
| `#camera-canvas` | `<canvas>` para la estela, encima del video |
| `#status` | Estado de la cámara |
| `#arena-status` | Arena conectada o esperando |
| `#mic-status` | Estado del micrófono |
| `#mic-meter` | Barra de volumen; Juan le pone el ancho con `style.width` |
| `#event-log` | `<ol>`; Juan inserta los `<li>` |

**Props de `AgentPanel`** (`apps/arena/src/ui/agent-panel.tsx`, de Angel; Juan lo conecta a los datos):

```ts
export type AgentPanelState = "connecting" | "connected" | "detector-closed" | "not-found" | "camera-error";
export interface AgentPanelProps {
  state: AgentPanelState;
  handVisible: boolean;
  lastSpell: { spellId: SpellId; confidence: number } | null;
  errorMessage: string | null;
  onRetry: () => void;
  onUseBrowserCamera: () => void;
}
```

**Archivos de cada uno:**
- Johan: `apps/local-agent/src/server.ts` y `test/`.
- Juan: `detector/main.ts`, `packages/spell-engine` y la lógica de la Arena.
- Angel: el HTML y el CSS del detector, `agent-panel.tsx` y sus estilos.
- Daniel: `README.md` y `docs/`.

Nadie toca `packages/contracts`; si algo falta, se le avisa a Felipe. El lockfile ya tiene `ws`: nadie agrega dependencias sin avisar.


## Datos comunes

- **Estado:** la fase 1 está en `main`. Se prueba con `corepack pnpm --filter @duelo/local-agent start`.
- **El `.env` de `apps/local-agent`:**
  - `AGENT_PORT=47800`;
  - `ALLOWED_ORIGINS=http://localhost:5174,<URL de la Arena en Vercel>`;
  - `AGENT_OPEN_BROWSER=` (vacío abre Chrome).
- **La Arena:** `VITE_LOCAL_AGENT_URL=ws://127.0.0.1:47800/events`.
- **Orden:**
  1. Johan, Juan, Angel y Daniel trabajan en paralelo.
  2. Juan integra cuando el servidor de Johan esté en `main`.
  3. Todos prueban en dos PCs.
- **Ramas:**
  - Johan: `feat/agente-local-servidor`;
  - Juan: `feat/agente-local-detector`;
  - Angel: `feat/agente-local-ui`;
  - Daniel: `docs/agente-local`.
- **Preparar la rama:**

  ```bash
  git checkout main && git pull
  git checkout -b <rama>
  corepack pnpm install
  ```

## Johan Soriano (Claude Pro): el WebSocket del agente

Prompt para Claude Code:

```text
Soy Johan Soriano, del proyecto "Duelo de hechiceros". Lee CLAUDE.md (fuente de verdad) y
docs/plan-agente-local.md (sección "Johan"). Esta vez trabajo en apps/local-agent/src/server.ts
y apps/local-agent/test/, no en services/game-server. No toques packages/contracts ni otras
carpetas: si algo falta en el protocolo, detente y explícame qué cambiar para avisarle a Felipe.

Contexto: apps/local-agent es el agente local (R2). Corre en el PC del jugador. Ya existen
src/config.ts (AGENT_HOST, loadConfig, detectorUrl), src/server.ts (servidor node:http en
127.0.0.1 que sirve dist/detector y responde /health con un objeto `status` mutable) y
src/launcher.ts. El protocolo está en packages/contracts/src/local-agent.ts:
LOCAL_AGENT_EVENTS_PATH, LOCAL_AGENT_PROTOCOL_VERSION, parseLocalAgentMessage y
LOCAL_AGENT_SENDERS. ws 8.23.0 y @types/ws 8.18.2 ya están instalados. No agregues
dependencias.

Tarea: agregar a startServer un WebSocketServer de `ws` montado sobre el mismo servidor HTTP,
solo en LOCAL_AGENT_EVENTS_PATH:
1. En el upgrade, valida el header Origin: debe estar en config.allowedOrigins o ser el
   origen del propio detector (detectorUrl). Si no, responde 403 y destruye el socket, sin
   aceptar la conexión. Usa maxPayload pequeño (4 KB): solo viajan eventos.
2. El primer mensaje debe ser agent:hello con un role válido y
   protocolVersion === LOCAL_AGENT_PROTOCOL_VERSION. Si no lo es, ciérralo con un código 4000+
   y un motivo legible. Si no llega en 5 s, ciérralo.
3. Máximo un detector y una arena: si llega otro del mismo rol, cierra el anterior (código
   4001, "Reemplazado por una conexión nueva").
4. Reenvío: usa parseLocalAgentMessage. Reenvía al otro rol solo si LOCAL_AGENT_SENDERS
   dice que el mensaje es de quien lo manda. Lo demás se ignora con un aviso en consola.
   Nunca reenvíes agent:hello ni agent:peer.
5. Cada vez que entra o sale un rol, actualiza `status` (lo lee /health) y manda
   agent:peer { detector, arena } a los dos.
6. Un ping cada 10 s; termina los sockets que no respondieron el anterior. close() del
   servidor debe cerrar también el WebSocketServer y el intervalo.
7. Log de consola para la demo: "[agente] arena conectada desde <origin>",
   "[agente] detector conectado", "[agente] lightning 0.91 → arena", etc. No registres el
   contenido de agent:config completo en cada mensaje: con el tipo basta.

Pruebas en test/server.test.ts (vitest, puerto 0, con el cliente de `ws`):
origen no permitido rechazado; detector → arena reenvía agent:spell; un agent:config enviado
por el detector no se reenvía; hello con otra versión se cierra; una segunda arena reemplaza a la
primera; /health refleja quién está conectado; agent:peer llega a ambos.

Al terminar corre `corepack pnpm --filter @duelo/local-agent typecheck`, `test` y `build`, y
arranca el agente con `start` para probarlo de verdad. No hagas commit ni push: dame los
comandos. El PR va a main con reviewers Felipe y Juan.
```

## Juan Arias (Claude Pro): el detector, LocalAgentSource y la Arena

**Antes:** su parte de la integración (el punto 3) necesita el WebSocket de Johan. Juan empieza por los puntos 1 y 2 y prueba con un WebSocket falso.

Prompt para Claude Code:

```text
Soy Juan Arias, dueño de packages/spell-engine y apps/arena del proyecto "Duelo de
hechiceros". Lee CLAUDE.md y docs/plan-agente-local.md (sección "Juan"). Trabajo en
apps/local-agent/detector/main.ts, packages/spell-engine y apps/arena. No toques
packages/contracts, apps/local-agent/src (es de Johan), detector/index.html ni
detector/styles.css (son de Angel). Si algo del protocolo falta, detente y explícamelo.

Contexto: la fase 1 está en main. El protocolo agent:* está en
packages/contracts/src/local-agent.ts (LOCAL_AGENT_EVENTS_PATH,
LOCAL_AGENT_PROTOCOL_VERSION, parseLocalAgentMessage). El agente sirve la ventana del
detector en http://127.0.0.1:AGENT_PORT, con MediaPipe en ./mediapipe/wasm y
./mediapipe/hand_landmarker.task. SpellSource (spell-source.ts) ya está pensado para "un
agente local externo".

Tareas:

1. Detector (apps/local-agent/detector/main.ts, TypeScript sin React). Angel hace el HTML con
   estos IDs: #camera-video, #camera-canvas, #status, #arena-status, #mic-status,
   #mic-meter (ancho con style.width) y #event-log (<ol>, tú insertas los <li>, máximo 10).
   Si un ID no existe aún, no falles: crea un HTML mínimo de prueba solo en tu rama local.
   - Crea SpellEngine y VoiceListener igual que apps/arena/src/engine/use-spell-source.ts y
     use-voice.ts. Dibuja la estela con drawStroke/drawSeal. Grimorio inicial
     ["lightning", "shield"] y meteor hasta que llegue agent:config.
   - Conéctate por WebSocket al mismo origen (location.host + LOCAL_AGENT_EVENTS_PATH),
     manda agent:hello { role: "detector", protocolVersion } y reconecta si se cae.
   - agent:config → setGrimoire y el definitivo. Cada handler se envía como su mensaje
     (onSpell → agent:spell, etc.). agent:error lleva code, message y fatal, sin cause.
   - Manda agent:status al conectar y solo cuando cambia la cámara, la mano visible o el
     micrófono, nunca en cada fotograma.

2. LocalAgentSource implements SpellSource
   (packages/spell-engine/src/local-agent-source.ts, exportado en index.ts):
   - Recibe url, grimoire, ultimateId, minConfidence, handlers y un callback de estado
     (detector conectado, cámara, mano visible y micrófono). No lee import.meta.env.
   - start(): conecta y manda hello como "arena". Si no conecta en 3 s, emite el error
     nuevo AGENT_NOT_RUNNING (agrégalo en events.ts con su mensaje en español: "No
     encontramos el agente local. Ábrelo con…") y devuelve false. Reintenta si se cae.
   - setGrimoire y setUltimate mandan agent:config. Los mensajes del detector se convierten en
     los handlers de siempre (onSpell, onUltimate, onSealCharging…).
   - Pruebas con un WebSocket falso inyectable.

3. Arena (cuando el servidor de Johan esté en main):
   - use-spell-source.ts: por defecto LocalAgentSource con VITE_LOCAL_AGENT_URL (en config.ts,
     como las demás URL); SpellEngine si el jugador eligió "Usar la cámara del navegador"
     (guárdalo en sessionStorage); KeyboardSpellSource con ?teclado.
   - En modo agente la Arena NO abre cámara ni micrófono (en Windows la webcam no se
     comparte): useVoice queda apagado y los definitivos llegan por agent:ultimate.
   - En la calibración, en el duelo y en el entrenamiento, el espacio de la cámara muestra
     <AgentPanel> de Angel (apps/arena/src/ui/agent-panel.tsx). Sus props:
     state "connecting" | "connected" | "detector-closed" | "not-found" | "camera-error",
     handVisible, lastSpell, errorMessage, onRetry y onUseBrowserCamera. Si su PR no ha
     entrado, usa un panel provisional con esas mismas props.
   - El botón "Estoy listo" de la calibración depende de handVisible del agente.

Verifica: typecheck, test y build de @duelo/spell-engine, @duelo/arena y
@duelo/local-agent. Luego, con el agente abierto, el api y el game-server locales, juega una
partida: el zigzag en la ventana del detector baja la vida del rival. Prueba también cerrar el
agente a mitad de partida. No hagas commit ni push: dame los comandos. El PR va a main con
reviewers Felipe y Angel.
```

## Angel Arenales (Claude Pro): diseño de la ventana del agente y AgentPanel

Prompt para Claude Code:

```text
Soy Angel Arenales, del proyecto "Duelo de hechiceros". Lee CLAUDE.md (fuente de verdad) y
docs/plan-agente-local.md (sección "Angel"). Esta vez trabajo en apps/local-agent/detector
(solo index.html y styles.css) y en apps/arena/src/ui/agent-panel.tsx más sus estilos en
apps/arena/src/arena.css. No toques detector/main.ts ni la lógica de la Arena (son de Juan),
apps/local-agent/src (es de Johan) ni packages/contracts: si algo falta, detente y explícamelo.

Necesito dos piezas de UI para el "agente local": un programa que corre en el PC del jugador,
abre la cámara en su propia ventana y le pasa a la Arena solo eventos de hechizos. Antes de
escribir, lee apps/arena/src/arena.css y reutiliza sus colores (fondo #161322/#1b172b, bordes
#342b47, texto #f5f1ff, secundario #aca5c2, violeta #7952ff, verde #6ce3a1, rosa #ff839c), y
apps/arena/src/ui/spell-glyph.tsx y end-screen.tsx como ejemplo de componente.

1. Ventana del detector: apps/local-agent/detector/index.html (reemplaza el provisional) y
   apps/local-agent/detector/styles.css, enlazado desde el HTML. Es una página sin React de
   unos 520×760 px. Debe tener EXACTAMENTE estos IDs, porque Juan los usa desde main.ts:
   - #camera-video (<video playsinline muted>) y #camera-canvas (<canvas> encima del video,
     del mismo tamaño, para la estela; el video se ve en espejo con transform: scaleX(-1),
     igual que el canvas);
   - #status (estado de la cámara), #arena-status (Arena conectada o esperando),
     #mic-status (micrófono) y #mic-meter (barra de volumen; Juan le cambia style.width);
   - #event-log: <ol> con los últimos eventos (Juan inserta <li>; dale estilo a
     li, li.ok y li.failed);
   - un título "Agente local" y la leyenda "Todo se procesa en este PC: a la Arena solo
     viajan eventos".
   Deja el <script type="module" src="./main.ts"></script> tal cual.

2. Componente apps/arena/src/ui/agent-panel.tsx, con sus estilos al final de arena.css
   (clases ar-agent*). Ocupa el lugar del video de la cámara en la Arena (unos 442×332).
   Props exactas:
     export type AgentPanelState = "connecting" | "connected" | "detector-closed" | "not-found" | "camera-error";
     export interface AgentPanelProps {
       state: AgentPanelState; handVisible: boolean;
       lastSpell: { spellId: SpellId; confidence: number } | null;
       errorMessage: string | null; onRetry: () => void; onUseBrowserCamera: () => void;
     }
   (SpellId viene de "@duelo/contracts".) Estados:
   - connecting: "Buscando el agente local…";
   - connected: "Agente local conectado", si se ve la mano y el último hechizo con su icono
     (usa <SpellGlyph id=... />) y la confianza en %;
   - detector-closed: el agente está abierto, pero su ventana no. Dile que la abra o que
     reinicie el agente;
   - not-found: los pasos para abrirlo ("corepack pnpm --filter @duelo/local-agent
     start"), un botón "Reintentar" (onRetry) y un botón secundario "Usar la cámara del
     navegador" (onUseBrowserCamera);
   - camera-error: muestra errorMessage y el botón Reintentar.
   Accesible: role="status" en el texto que cambia y botones de verdad.

Verifica: `corepack pnpm --filter @duelo/arena typecheck` y `build`, y
`corepack pnpm --filter @duelo/local-agent build`. Abre el agente con `start` y revisa la
ventana del detector en el navegador (sin main.ts de Juan los textos quedan fijos: llena a mano
con datos de ejemplo para ver cómo se ve una lista con eventos, sin dejarlos en el HTML). Para
AgentPanel, muéstralo temporalmente en sus 5 estados en la Arena local (5174) y quita ese
código antes de terminar. No hagas commit ni push: dame los comandos. El PR va a main con
reviewers Juan y Felipe.
```

## Daniel Tapiero (sin Claude Pro): README, guion de la demo y pruebas

Prompt para el chat de Claude. Adjunta:
- `README.md`;
- `docs/plan-agente-local.md`;
- `apps/local-agent/.env.example`;
- `apps/local-agent/package.json`.

```text
Soy Daniel Tapiero, del proyecto "Duelo de hechiceros". Te adjunto el README, el plan del
"agente local" y su configuración. El profesor dijo que no se veía el módulo local (R2), y
por eso el reconocimiento de gestos y voz ahora corre en un programa aparte en el PC del
jugador. Escribe en español claro, sin inventar comandos que no estén en los archivos.

1. Una sección "## Agente local (R2)" en README.md, después de "## Levantar en local":
   qué es y por qué existe (2–3 líneas), requisitos (Node 22.12 o superior, Chrome o Edge,
   pnpm vía corepack), cómo abrirlo (copiar .env.example a .env, rellenar AGENT_PORT y
   ALLOWED_ORIGINS, `corepack pnpm --filter @duelo/local-agent start`), qué debe
   verse (la ventana del detector y los mensajes "[agente]" en la consola) y una tabla de
   problemas comunes:
   - puerto ocupado ("El puerto ... ya está en uso");
   - falta el .env;
   - Chrome pregunta si la página puede acceder a la red local o a dispositivos locales:
     hay que permitirlo;
   - cámara en uso por otra app;
   - no se encuentra Chrome (abrir a mano la URL que imprime);
   - la Arena dice "No encontramos el agente local".
   Actualiza también la fila de R2 en "### Cómo se cumple cada requisito".

2. docs/guion-agente-local.md: el guion de 3–4 minutos para demostrar R2 ante el profesor,
   paso a paso y con lo que se dice en cada paso:
   1. abrir el agente y mostrar el proceso node en el Administrador de tareas;
   2. jugar un hechizo y mostrar en la consola "[agente] lightning 0.91 → arena";
   3. DevTools de la Arena → Network → WS: solo mensajes pequeños por ws://127.0.0.1,
      nada de video;
   4. cerrar el agente: la Arena muestra "No encontramos el agente local", y se reabre;
   5. desconectar internet: la ventana del detector sigue reconociendo los gestos (la
      partida y la voz sí necesitan internet; dilo con honestidad).

3. docs/pruebas-agente-local.md: lista de verificación con casillas para el ensayo en dos
   PCs (instalar, abrir, calibrar, cada hechizo del grimorio, definitivo por voz, cerrar el
   agente a mitad de partida, origen no permitido, sin internet), con columnas PC 1 y PC 2.

Entrega los archivos completos y los comandos de git para mi rama docs/agente-local.
```

El PR va a `main` con reviewers Felipe y Johan. Cuando Juan termine, Daniel repasa el guion contra la app real.

## Felipe (tú)

- Agregar `VITE_LOCAL_AGENT_URL=ws://127.0.0.1:47800/events` en Vercel, en el proyecto de la Arena, y redesplegar solo la Arena.
- Revisar los PRs de Johan y Juan antes que los demás: el de Juan depende del de Johan.
- Ensayar en dos PCs con la lista de Daniel.

