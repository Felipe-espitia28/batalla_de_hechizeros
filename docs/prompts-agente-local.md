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
  - `ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174,<URL del shell en Vercel>,<URL de la Arena en Vercel>`. **Debe incluir el shell:** dentro de él, el navegador manda el Origin del shell; sin él, el agente rechaza la Arena con 403;
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

## Daniel Tapiero (Claude Pro, desde el 19 nov): README, guion de la demo y pruebas

Prompt para Claude Code:

```text
Soy Daniel Tapiero, del proyecto "Duelo de hechiceros". Lee CLAUDE.md (fuente de verdad),
docs/plan-agente-local.md, README.md, apps/local-agent/.env.example y
apps/local-agent/package.json. Esta vez trabajo solo en README.md y en docs/: no toques
código. El profesor dijo que no se veía el módulo local (R2), y por eso el reconocimiento de
gestos y voz ahora corre en un programa aparte en el PC del jugador (el agente local).
Escribe en español claro y no inventes comandos: cada comando que cites debe existir en un
package.json o en el README (compruébalo leyendo los archivos).

1. Una sección "## Agente local (R2)" en README.md, después de "## Levantar en local",
   qué es y por qué existe (2–3 líneas), con DOS caminos:
   a) Jugadores: descargar agente-local-windows.zip de la página de Releases del repo (o del
      botón "Descargar el agente" de la Arena), descomprimir, doble clic en
      "Iniciar agente.bat", permitir cámara y micrófono y abrir el juego. Requisito: Node 22
      o superior y Chrome o Edge.
   b) Desarrolladores: requisitos (Node 22.12 o superior, Chrome o Edge, `corepack enable`
      para que exista el comando pnpm: los scripts lo llaman por dentro), copiar
      .env.example a .env, rellenar AGENT_PORT y ALLOWED_ORIGINS y
      `pnpm --filter @duelo/local-agent start`.
   Qué debe verse (la ventana del detector y los mensajes "[agente]" en la consola) y una
   tabla de problemas comunes:
   - "pnpm no se reconoce" (falta `corepack enable`, como administrador si hace falta);
   - puerto ocupado ("El puerto ... ya está en uso");
   - falta el .env;
   - Chrome pregunta si la página puede acceder a la red local o a dispositivos locales:
     hay que permitirlo;
   - cámara en uso por otra app;
   - no se encuentra Chrome (abrir a mano la URL que imprime);
   - la Arena dice "No encontramos el agente local";
   - la consola del agente dice "conexión rechazada desde http://localhost:5173": falta el shell en
     ALLOWED_ORIGINS (dentro del shell, el Origin es el del shell). Se agrega y se reinicia el agente.
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

Antes de terminar, comprueba que cada ruta y comando citado exista en el repo. No hagas
commit ni push: dame los comandos de git para mi rama docs/agente-local.
```

El PR va a `main` con reviewers Felipe y Johan. Cuando Juan termine, Daniel repasa el guion contra la app real.

### Daniel · tarea 4: rediseño de la ventana del detector

Va en una rama aparte, para que cada PR sea pequeño. Se puede hacer antes o después de la documentación.

```bash
git checkout main && git pull
git checkout -b feat/agente-local-detector-ui
pnpm install
```

Prompt para Claude Code:

```text
Soy Daniel Tapiero, del proyecto "Duelo de hechiceros". Lee CLAUDE.md y docs/plan-agente-local.md.
Tarea: rediseñar la ventana del detector del agente local (apps/local-agent/detector/), que hoy
parece una página de configuración. Debe verse como parte del juego (mismos colores, iconos y
logo que la Arena), con la cámara como protagonista y que se entienda de un vistazo: Arena
conectada, micrófono listo, qué hechizos tengo y qué se detectó. Cubro áreas de Angel (HTML/CSS)
y de Juan (main.ts): lo diré en el PR. No toques packages/contracts, apps/local-agent/src (el
servidor), la Arena ni el protocolo agent:*. Antes de escribir, lee detector/index.html,
detector/styles.css, detector/main.ts, apps/arena/src/arena.css y apps/arena/src/ui/spell-glyph.tsx.

Diseño (ventana de 520×760, sin scroll de página; solo la lista de eventos se desplaza):
  [logo] Agente local / Duelo de hechiceros         ← encabezado
  ● Arena conectada   ● Micrófono listo             ← dos chips de estado
  ┌ cámara 4:3 a todo el ancho (≈480×360) ────────┐  insignia "EN VIVO · solo en este PC";
  │ video + estela                                │  borde violeta con brillo si se ve la mano;
  │        ( ✅ Mano detectada: haz la pinza )     │  estado como píldora flotante abajo
  └───────────────────────────────────────────────┘
  Volumen ▓▓▓▓▓▓░░░░│░░░                           ← barra con marca del umbral del grito
  Tu grimorio: [⚡ Rayo · zigzag] [🛡 Escudo · círculo] … + "☄ Meteoro: grita «¡Meteoro!»"
  Últimos eventos: fila = icono · nombre · barra de confianza · % · hora · "→ Arena"
  🔒 Nada de video sale de tu PC · cierra esta ventana para apagar la cámara   ← pie

Reglas:
- Los 7 IDs NO cambian (main.ts los usa): #camera-video, #camera-canvas, #status, #arena-status,
  #mic-status, #mic-meter, #event-log. Agrega #grimoire (vacío, lo llena main.ts).
- Colores: las variables que ya tiene styles.css (las mismas de arena.css). Sin librerías nuevas
  ni fuentes de internet: la ventana debe funcionar sin conexión.
- Recursos: copia apps/shell/public/logo-duelo.png a detector/public/logo-duelo.png y los 12 SVG de
  apps/arena/public/ui/entrenamiento/ que usa spell-glyph.tsx a detector/public/hechizos/.
- Estados: cargando (spinner sobre la cámara), error (tarjeta rosa con el mensaje), Arena
  esperando (punto ámbar con pulso) o conectada (verde), micrófono no disponible (chip gris con el
  motivo completo en title). Respeta prefers-reduced-motion y deja foco visible.
- Accesibilidad: conserva los role="status" y el aria-live de la lista.

Cambios en main.ts (solo las funciones que pintan la pantalla; nada del WebSocket ni del motor):
- renderCameraStatus: además pone data-hand="true|false" en el contenedor .camera (para el brillo).
- Micrófono: chip con texto corto ("Micrófono listo", "Pidiendo micrófono…", "Sin micrófono") y
  data-state; el mensaje largo va en title.
- Marca del grito: calcula --shout-at con DEFAULT_SHOUT_THRESHOLD de @duelo/spell-engine y la
  misma escala que ya usa la barra (sqrt(nivel / 0.2)), para que la marca coincida con el grito real.
- log(): filas con <img> del icono (./hechizos/<archivo>.svg, mismo mapa que spell-glyph.tsx),
  nombre, barra de confianza, %, hora y "→ Arena" / "(Arena no conectada)". Usa textContent, nunca
  innerHTML.
- renderGrimoire() nueva: al arrancar y en cada agent:config; un chip por hechizo (icono,
  SPELLS[id].name y versión corta de gestureDescription) y una línea para el definitivo con
  ULTIMATES[id].acceptedWords[0].
- Deja --window-size=520,760 en src/launcher.ts.

Verificación (obligatoria antes de terminar):
1. pnpm --filter @duelo/local-agent typecheck, test y build.
2. Arranca el agente en otro puerto (AGENT_PORT=47805 AGENT_OPEN_BROWSER=false) y abre
   http://127.0.0.1:47805: revisa los estados cargando y error de cámara; con un cliente ws de
   prueba con un origen de ALLOWED_ORIGINS manda agent:hello (role "arena") y un agent:config con
   fireball y storm: el chip debe ponerse verde y el grimorio mostrar 4 hechizos y «¡Tormenta!».
   Comprueba que todo cabe en 520×760 sin scroll de página.
3. pnpm --filter @duelo/local-agent package: el logo y los iconos deben quedar dentro de
   release/agente-local/detector/.
4. Pídeme probarlo con cámara y micrófono reales (brillo con la mano, estela alineada, barra que
   pasa la marca al gritar).
No hagas commit ni push: dame los comandos de git para la rama feat/agente-local-detector-ui.
```

El PR va a `main` con reviewers Angel y Juan (son sus archivos) y Felipe. Al fusionarlo, Felipe publica un ZIP nuevo con un tag `agente-v0.2.0` para que los jugadores reciban la ventana nueva.

## Felipe (tú)

- Agregar `VITE_LOCAL_AGENT_URL=ws://127.0.0.1:47800/events` en Vercel, en el proyecto de la Arena, y redesplegar solo la Arena.
- Revisar los PRs de Johan y Juan antes que los demás: el de Juan depende del de Johan.
- Ensayar en dos PCs con la lista de Daniel.

