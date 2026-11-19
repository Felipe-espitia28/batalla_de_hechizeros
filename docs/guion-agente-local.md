# Guion: demostración del agente local (R2)

**Duración:** 3–4 minutos.
**Objetivo:** que se vea, sin lugar a dudas, que el reconocimiento de gestos y voz corre en un **programa aparte en el PC del jugador** y que a la nube solo viajan eventos pequeños.

Instalación y problemas comunes: sección [Agente local (R2)](../README.md#agente-local-r2) del README.

---

## Antes de empezar (no cuenta en el tiempo)

- [ ] El agente **cerrado**: se abre en vivo en el paso 1.
- [ ] La Arena abierta en Chrome (dentro del shell o sola), con la sesión iniciada.
- [ ] Ya se aceptó una vez el permiso de Chrome para acceder a la red local o a dispositivos locales. Si aparece en vivo, se acepta y se explica que es la conexión a `127.0.0.1`.
- [ ] Administrador de tareas abierto en la pestaña **Procesos**.
- [ ] Pantalla dividida: la ventana del detector a un lado y la Arena al otro.
- [ ] Una partida lista contra el PC 2, o la Arena en el modo de entrenamiento.

---

## Paso 1 · Abrir el agente y verlo en el Administrador de tareas (≈40 s)

**Qué se hace:**
1. Doble clic en `Iniciar agente.bat`, o en el repositorio `pnpm --filter @duelo/local-agent start`.
2. Se abre la ventana **"Agente local"** con la cámara.
3. En la consola aparece `[agente] Agente local escuchando en http://127.0.0.1:47800 (solo este PC)`.
4. En el Administrador de tareas, mostrar el proceso **Node.js JavaScript Runtime**.

**Qué se dice:**
> "Este es el módulo local: un programa aparte que corre en el PC del jugador, no dentro de la página. Lo ven aquí como un proceso de Node. Escucha solo en 127.0.0.1, así que nadie desde la red puede conectarse a él. La cámara y el micrófono los abre él, no la página del juego: fíjense que el ícono de la cámara aparece en la ventana del agente, no en la Arena."

## Paso 2 · Lanzar un hechizo y verlo en la consola (≈40 s)

**Qué se hace:**
1. La Arena muestra el agente conectado y la consola dice `[agente] arena conectada desde …`.
2. Hacer la pinza y dibujar un zigzag frente a la cámara.
3. En la consola aparece **`[agente] lightning 0.91 → arena`**, y en la Arena se lanza el Rayo (en partida, baja la vida del rival).

**Qué se dice:**
> "El agente reconoció el zigzag con MediaPipe y nuestro reconocedor $1, y lo único que le pasó a la Arena es esto: 'lightning, con 0,91 de confianza'. Ese evento es lo que la Arena le manda después al game-server."

## Paso 3 · DevTools: solo eventos pequeños, nada de video (≈50 s)

**Qué se hace:**
1. En la Arena, F12 → **Network** → filtro **WS**.
2. Seleccionar la conexión `ws://127.0.0.1:47800/events` → pestaña **Messages**.
3. Dibujar otro hechizo y señalar el mensaje nuevo (`agent:spell` con `spellId` y `confidence`, de pocos bytes).
4. Mostrar la otra conexión (`wss://…` del game-server): solo `combat:cast-spell` y el estado de la partida.

**Qué se dice:**
> "Estas son todas las conexiones de la Arena. Con el agente, por 127.0.0.1, solo pasan mensajes de texto de unos pocos bytes. No hay ninguna petición con video ni audio: los fotogramas de la cámara nunca salen del agente."

## Paso 4 · Cerrar el agente y volver a abrirlo (≈40 s)

**Qué se hace:**
1. Cerrar el agente con `Ctrl+C` en su consola. Aparece `[agente] Cerrando…` y el proceso desaparece del Administrador de tareas.
2. La Arena muestra **"No encontramos el agente local"**, con las instrucciones y los botones.
3. Volver a abrir el agente y pulsar **Reintentar** en la Arena: vuelve a conectar.

**Qué se dice:**
> "Sin el agente, la Arena no puede reconocer nada y se lo dice al jugador. Demuestra que el reconocimiento vive en ese programa y no en la página. Lo abrimos de nuevo y la Arena se reconecta."

## Paso 5 · Sin internet: el detector sigue reconociendo (≈40 s)

**Qué se hace:**
1. Desconectar el Wi-Fi del PC.
2. Dibujar un zigzag y un círculo: la ventana del detector los reconoce y los agrega a **"Últimos eventos"**.
3. Volver a conectar el Wi-Fi.

**Qué se dice (con honestidad):**
> "Sin internet, el detector sigue reconociendo gestos, porque MediaPipe y el modelo los sirve el propio agente desde este PC. Lo que sí necesita internet es la partida, porque el rival y el game-server están en la nube, y la voz de los definitivos, porque Chrome manda el audio a su servicio de reconocimiento. Eso pasa entre Chrome y Google: a nuestros servidores nunca llega audio."

---

## Si algo falla en vivo

| Problema | Qué hacer |
|---|---|
| Chrome pide permiso de red local | Aceptarlo y decir que es la conexión a `127.0.0.1` |
| "El puerto … ya está en uso" | Había otro agente abierto: cerrarlo y volver a abrir |
| La cámara está ocupada por otra aplicación | Cerrar Zoom, Meet, Teams u otra pestaña con la cámara y reabrir el agente |
| La consola dice "conexión rechazada desde …" | El origen de la página no está en `ALLOWED_ORIGINS`: agregarlo al `.env` y reiniciar el agente |
| El agente no arranca de ninguna forma | En la Arena, "Usar la cámara del navegador" (el mismo motor dentro de la página), y explicar el agente con capturas del ensayo |
