# Pruebas manuales del agente local (ensayo en dos PCs)

Lista para marcar durante el ensayo. Cada fila se prueba en los **dos** PCs: se marca la casilla si funcionó, y se anota en "Notas" qué pasó si algo falló.

- **PC 1:** __________________ (quién / cuenta)
- **PC 2:** __________________ (quién / cuenta)
- **Fecha:** __________ · **Versión del agente:** ZIP `agente-v____` o rama ______

Instalación y problemas comunes: sección [Agente local (R2)](../README.md#agente-local-r2) del README. Guion de la demo: [guion-agente-local.md](guion-agente-local.md).

---

## 1. Instalar

| # | Prueba | Resultado esperado | PC 1 | PC 2 | Notas |
|---|---|---|---|---|---|
| 1.1 | Node.js 22 o superior instalado ([nodejs.org](https://nodejs.org)) | `Iniciar agente.bat` no muestra "No encontramos Node.js" ni "Tu Node.js es muy antiguo" | ☐ | ☐ | |
| 1.2 | Chrome o Edge instalado y actualizado | Abre normalmente | ☐ | ☐ | |
| 1.3 | Descargar `agente-local-windows.zip` (Releases o botón "Descargar el agente" de la Arena) y descomprimir | Están `Iniciar agente.bat`, `agente.mjs`, `detector/` y `LEEME.txt` | ☐ | ☐ | |
| 1.4 | *(Solo desarrolladores)* `corepack enable`, `pnpm install` y `.env` creado desde `apps/local-agent/.env.example` | `pnpm` existe y el `.env` tiene `AGENT_PORT` y `ALLOWED_ORIGINS` | ☐ | ☐ | |

## 2. Abrir

| # | Prueba | Resultado esperado | PC 1 | PC 2 | Notas |
|---|---|---|---|---|---|
| 2.1 | Doble clic en `Iniciar agente.bat` (o `pnpm --filter @duelo/local-agent start`) | Consola con `[agente] Agente local escuchando en http://127.0.0.1:…` | ☐ | ☐ | |
| 2.2 | Ventana del detector | Se abre "Agente local" con la leyenda "Todo se procesa en este PC" | ☐ | ☐ | |
| 2.3 | Permisos de cámara y micrófono en el detector | Se ve la cámara; el estado del micrófono queda listo | ☐ | ☐ | |
| 2.4 | Administrador de tareas | Aparece el proceso **Node.js JavaScript Runtime** | ☐ | ☐ | |
| 2.5 | Abrir la Arena (dentro del shell desplegado) | Si Chrome pregunta por la red local o dispositivos locales, se permite. La Arena muestra el agente conectado y la consola dice `[agente] arena conectada desde …` | ☐ | ☐ | |
| 2.6 | Abrir el agente dos veces | El segundo dice `El puerto … ya está en uso` y el primero sigue funcionando | ☐ | ☐ | |

## 3. Calibrar

| # | Prueba | Resultado esperado | PC 1 | PC 2 | Notas |
|---|---|---|---|---|---|
| 3.1 | Mostrar la mano frente a la cámara | El detector marca la mano visible y la Arena lo refleja | ☐ | ☐ | |
| 3.2 | Pinza (pulgar e índice) y mover el dedo | Se dibuja la estela en el detector | ☐ | ☐ | |
| 3.3 | Luz y distancia | Con la luz del salón, la mano se detecta a ~1 m | ☐ | ☐ | |

## 4. Cada hechizo del grimorio

En partida o en el entrenamiento. Rayo y Escudo siempre están en el grimorio; los demás, solo si la cuenta los compró y los puso en el grimorio. Para cada uno se espera la línea `[agente] <id> <confianza> → arena` en la consola, el evento en "Últimos eventos" del detector y el efecto en la Arena.

| # | Hechizo (id) | Gesto | PC 1 | PC 2 | Notas |
|---|---|---|---|---|---|
| 4.1 | ⚡ Rayo (`lightning`) | Zigzag, de izquierda a derecha | ☐ | ☐ | |
| 4.2 | 🛡️ Escudo (`shield`) | Círculo | ☐ | ☐ | |
| 4.3 | 🗡️ Corte (`slash`) | Línea recta, en cualquier dirección | ☐ | ☐ | |
| 4.4 | 🔥 Bola de fuego (`fireball`) | Triángulo | ☐ | ☐ | |
| 4.5 | 💚 Curación (`heal`) | V | ☐ | ☐ | |
| 4.6 | 🐍 Veneno (`poison`) | S, de arriba hacia abajo | ☐ | ☐ | |
| 4.7 | ❄️ Congelar (`freeze`) | Cuadrado | ☐ | ☐ | |
| 4.8 | ✖️ Sello de silencio (`silence-seal`) | X con los dos índices, sostenida 0,7 s (círculo de carga) | ☐ | ☐ | |
| 4.9 | Gesto mal hecho | "Hechizo fallido" en el detector; no gasta maná | ☐ | ☐ | |
| 4.10 | Lanzado en el PC 1 | Baja la vida en el PC 2 (y al revés) | ☐ | ☐ | |

## 5. Definitivo por voz

| # | Prueba | Resultado esperado | PC 1 | PC 2 | Notas |
|---|---|---|---|---|---|
| 5.1 | Con el maná lleno, gritar "¡Meteoro!" | El detector registra el definitivo y la consola dice `[agente] definitivo meteor → arena`; el rival recibe el daño | ☐ | ☐ | |
| 5.2 | Decir "meteoro" sin gritar | No se lanza (falta volumen) | ☐ | ☐ | |
| 5.3 | Gritar otra palabra | No se lanza | ☐ | ☐ | |
| 5.4 | Bloquear el micrófono | Solo se desactivan los definitivos; los gestos siguen funcionando | ☐ | ☐ | |

## 6. Cerrar el agente a mitad de partida

| # | Prueba | Resultado esperado | PC 1 | PC 2 | Notas |
|---|---|---|---|---|---|
| 6.1 | `Ctrl+C` en la consola del agente durante una partida | Consola: `[agente] Cerrando…`. La Arena muestra "No encontramos el agente local" | ☐ | ☐ | |
| 6.2 | Reabrir el agente y pulsar **Reintentar** | La Arena vuelve a conectar y se puede seguir lanzando hechizos | ☐ | ☐ | |
| 6.3 | Respaldo: "Usar la cámara del navegador" | La Arena usa la cámara dentro de la página y se puede jugar | ☐ | ☐ | |

## 7. Origen no permitido

| # | Prueba | Resultado esperado | PC 1 | PC 2 | Notas |
|---|---|---|---|---|---|
| 7.1 | Quitar el shell de `ALLOWED_ORIGINS`, reiniciar el agente y abrir la Arena dentro del shell | Consola: `[agente] conexión rechazada desde <origen del shell>: no está en ALLOWED_ORIGINS`. La Arena no conecta | ☐ | ☐ | |
| 7.2 | Volver a agregar el shell y reiniciar el agente | Conecta otra vez | ☐ | ☐ | |

## 8. Sin internet

| # | Prueba | Resultado esperado | PC 1 | PC 2 | Notas |
|---|---|---|---|---|---|
| 8.1 | Desconectar el Wi-Fi con el agente abierto y dibujar gestos | El detector sigue reconociendo y los agrega a "Últimos eventos" | ☐ | ☐ | |
| 8.2 | Gritar un definitivo sin internet | No funciona (la voz necesita internet); el detector avisa del error de red | ☐ | ☐ | |
| 8.3 | Volver a conectar | La partida y la voz vuelven a funcionar | ☐ | ☐ | |

---

## Resultado del ensayo

- ☐ Todo en verde en los dos PCs: listo para la sustentación.
- Fallas encontradas y quién las arregla:
  1. ______________________________________
  2. ______________________________________
