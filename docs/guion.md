# Guion de la sustentación — Duelo de hechiceros

Demostración en vivo de los requisitos R1–R7, en el orden en que se cuenta la historia: primero dónde vive el sistema (nube y micro frontends), luego una partida real entre dos PCs (local, cámara, micrófono, sockets), y al final dónde quedaron los datos y el código.

**Duración objetivo:** 15–18 minutos de demo y 5 de preguntas.
**Equipos:** PC A (proyector, presenta) y PC B (rival), ambos con cámara y micrófono.

---

## 0. Preparación (antes de entrar al salón)

| Cuándo | Qué | Responsable |
|---|---|---|
| 1 día antes | Ensayo completo con este guion, cronometrado, en la red de la universidad si es posible | Todos |
| 1 día antes | Cuentas de la demo creadas en producción, con oro suficiente para comprar en la Tienda | Angel |
| 1 día antes | Grabar un video de respaldo de una partida completa (plan B) | Juan |
| 30 min antes | Abrir en el PC A, en este orden: shell, api `/health`, game-server, ranking. **Render free tarda ~1 min en despertar** y Neon se suspende tras 5 min sin uso | Felipe |
| 30 min antes | Dar permiso de cámara y micrófono al dominio de la Arena en **ambos** navegadores (Chrome) | Juan |
| 15 min antes | Iniciar sesión en PC A y PC B con dos cuentas distintas y jugar una partida corta de calentamiento (también deja los servicios despiertos) | Juan y Johan |
| 15 min antes | Pestañas abiertas en el PC A (ver lista abajo) | Daniel |
| 5 min antes | Hotspot del celular listo por si falla la red | Felipe |

**Pestañas del PC A, en orden:**

1. Shell (URL de producción)
2. Las 4 URLs de los frontends (shell, arena, tienda y ranking)
3. Panel de Vercel con los 4 proyectos
4. Panel de Neon → Tables
5. Panel de Upstash → Data Browser
6. GitHub → Pull requests (cerrados) y Actions

> Las URLs reales están en la tabla "URLs desplegadas" del [README](../README.md).

---

## 1. Introducción (1 min) — Daniel

- Qué es el juego: duelo 1 contra 1, hechizos dibujados con la mano y definitivos gritados.
- Mostrar el diagrama de arquitectura del README: el navegador del jugador (módulo local y micro frontends) y la nube (game-server, api, PostgreSQL y Redis).
- Anunciar el orden: nube → micro frontends → partida en vivo → datos → código.

## 2. R1 — Desplegado en la nube (1,5 min) — Felipe

**Cómo se demuestra:** URLs públicas en vivo.

1. En el PC A, abrir el shell por su URL pública e iniciar sesión.
2. Abrir `<api>/health` en otra pestaña: responde `{ "ok": true }`.
3. Nombrar dónde corre cada parte: Vercel (4 frontends), Render (api y game-server), Neon (PostgreSQL) y Upstash (Redis), todo en capas gratuitas.

## 3. R7 — Micro frontends (2,5 min) — Felipe

**Cómo se demuestra:** 4 URLs distintas; redesplegar uno sin tocar el resto.

1. Abrir las 4 URLs (shell, arena, tienda y ranking): cada una es un proyecto distinto de Vercel.
2. En el shell, navegar Arena → Tienda → Ranking. En DevTools → Network, filtrar `remoteEntry.js`: cada sección se descarga desde **su propio dominio**.
3. **Despliegue independiente:** en el panel de Vercel, hacer *Redeploy* solo del proyecto Ranking. Mientras tanto, el shell, la Arena y la Tienda siguen funcionando. Al terminar, recargar el Ranking.
4. **Aislamiento de fallos** (si da el tiempo): el shell muestra "No se pudo cargar…" con un botón de reintento cuando un remote no responde, en lugar de quedarse en blanco.

## 4. Tienda y grimorio (1 min) — Angel

1. En la Tienda, comprar un hechizo (por ejemplo Bola de fuego) y mostrar que el oro baja en la barra del shell (evento `duelo:gold-changed`).
2. Ponerlo en el grimorio (espacio 3). Explicar que el grimorio lo consulta el game-server al api y nunca viaja desde el cliente.

## 5. R2 + R4 — Módulo local, cámara y micrófono (3 min) — Juan

**Cómo se demuestra (R2):** DevTools → Network: solo viajan eventos pequeños; sin internet la detección sigue.
**Cómo se demuestra (R4):** partida en vivo.

1. Entrar a la Arena en el PC A: calibración de cámara y estela del dedo índice al hacer la pinza.
2. Abrir DevTools → Network → WS, seleccionar el socket y mostrar los mensajes: al lanzar un hechizo solo sale `combat:cast-spell` con `{ matchId, castId, spellId, confidence }`. **No sale video ni audio.**
3. **Sin internet:** desconectar el Wi-Fi del PC A y dibujar un zigzag. La detección sigue funcionando y muestra el hechizo reconocido, porque MediaPipe y el reconocedor corren en el navegador. Volver a conectar.
4. **Micrófono:** con el maná lleno, gritar "¡Meteoro!". Se valida el volumen (Web Audio) y la palabra (Web Speech) en el PC; al servidor solo llega el definitivo y su transcripción.

## 6. R3 — Sockets en tiempo real (3 min) — Johan

**Cómo se demuestra:** dos PCs, un gesto en uno baja la vida en el otro.

1. PC A y PC B entran a la cola de la Arena: el matchmaking los empareja y arranca la cuenta 3-2-1.
2. PC B lanza ⚡ Rayo y la vida del PC A baja 10 en el proyector, en tiempo real.
3. PC A lanza 🛡️ Escudo y luego el PC B lanza Rayo: el escudo lo absorbe (el servidor es autoritativo y el cliente nunca calcula daño).
4. Jugar hasta el KO o hasta que se acabe el tiempo. Pantalla final con puntos y oro.
5. **Si da el tiempo (abandono):** en otra partida, cerrar la pestaña del PC B. El PC A ve la espera de 10 s y gana por abandono.

## 7. R5 — Dos bases de datos (2 min) — Daniel

**Cómo se demuestra:** tablas en Neon; claves en Upstash durante una partida.

1. **Durante la partida del paso 6** (o una nueva), en Upstash → Data Browser, mostrar las claves vivas:
   - `dh:match:{matchId}`: instantánea de la partida
   - `dh:user:{userId}:match`: partida activa del jugador
   - `dh:mm:queue`: cola de emparejamiento
   - `dh:ranking`: sorted set con el rating de cada jugador
2. **Al terminar**, en Neon → Tables:
   - `matches`: la fila de la partida (`end_reason`, `winner_id`, `duration_ms`)
   - `match_players`: `rating_before`, `rating_delta` y `gold_delta` de cada jugador
   - `users`: el `rating`, el `gold` y las `wins` actualizados
3. En el shell → **Ranking**: la posición y el historial ya muestran la partida, porque se recargan solos con `duelo:match-ended`.
4. Explicar la división: PostgreSQL guarda lo permanente y es la fuente de verdad; Redis guarda lo vivo y se puede reconstruir. Si Redis cae, el ranking sigue respondiendo desde PostgreSQL.

## 8. R6 — Código en GitHub (1,5 min) — Daniel

**Cómo se demuestra:** PRs, revisiones, Actions en verde.

1. GitHub → Pull requests → *Closed*: un PR por tarea y por integrante, cada uno con su revisión aprobada.
2. Abrir un PR (por ejemplo, el del ranking) y mostrar el check **`CI / verificar`** en verde. El CI instala, revisa tipos, compila y prueba solo los paquetes que cambiaron, con Postgres y Redis reales.
3. Settings → Rules: `main` protegida (exige PR, aprobación y CI en verde).
4. *Insights → Contributors*: participación de los 5 integrantes.

## 9. Cierre (1 min) — Daniel

- Recapitular R1–R7 en una frase cada uno, señalando en qué paso se vio.
- Abrir preguntas.

---

## Plan B

| Si falla… | Qué hacer | Qué requisito se sigue demostrando |
|---|---|---|
| **Un servicio de Render tarda en despertar** | Seguir con las partes que no lo necesitan (paso 3: R7, y el panel de Neon), y volver cuando `/health` responda. El shell y el ranking muestran "despertando", no una pantalla en blanco | R1, R7 |
| **La red de la universidad** | Pasar los dos PCs al hotspot del celular. Si tampoco hay datos, correr todo en local en el PC A (`pnpm db:up` y `pnpm dev:*`, ver README) y mostrar en local R2, R4, R5 (Postgres y Redis de Docker) y R7 (4 puertos distintos) | R2, R4, R5, R7 en local; R1 y R6 con capturas |
| **La cámara de un PC** | Cambiar a la cámara del otro PC o a una webcam USB de repuesto. Si no hay ninguna: en el PC A, correr la Arena en local con `?teclado` en la URL (modo teclado, solo en desarrollo) para jugar contra el PC B, y mostrar el video de respaldo para R4 | R3 en vivo; R4 con video |
| **El micrófono** | El juego sigue: sin micrófono solo se desactivan los definitivos. Mostrar el Meteoro en el video de respaldo | R4 parcial en vivo |
| **Un solo PC disponible** | Abrir la Arena en dos ventanas de navegador (una normal y otra de incógnito) con dos cuentas distintas | R3 |
| **Upstash (Redis)** | El ranking sigue respondiendo desde PostgreSQL; explicarlo como una decisión de diseño. Mostrar las claves con capturas tomadas en el ensayo | R5 con capturas |
| **Todo** | Video de respaldo de la partida completa y capturas de Vercel, Render, Neon, Upstash y GitHub tomadas el día anterior | Todos, en diferido |

**Checklist del día anterior para el plan B:** video de la partida, capturas de los 4 proyectos de Vercel, de Render, de las tablas de Neon, de las claves de Upstash durante una partida y de los PRs y Actions en verde. Repo clonado e instalado en el PC A (`pnpm install`) con Docker funcionando.
