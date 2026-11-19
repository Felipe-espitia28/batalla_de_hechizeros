/**
 * Arma el paquete del agente local para jugadores: release/agente-local/ (luego se comprime en un ZIP).
 *
 * Por qué: para jugar no debería hacer falta clonar el repo ni instalar pnpm. El paquete trae el
 * agente en un solo archivo (agente.mjs), la ventana del detector ya compilada con MediaPipe (así
 * funciona sin internet) y un .bat que lo abre con doble clic. Solo pide Node 22 o superior.
 *
 * Uso (después de `pnpm run build`, que deja dist/detector):
 *   RELEASE_ALLOWED_ORIGINS="https://shell…,https://arena…" node scripts/package.mjs
 * Variables:
 *   RELEASE_ALLOWED_ORIGINS  obligatoria: orígenes del shell y la Arena desplegados (separados por coma).
 *   RELEASE_AGENT_PORT       opcional (47800): debe coincidir con VITE_LOCAL_AGENT_URL de la Arena.
 * Ninguna URL va en el código: los orígenes llegan por variable (en CI, de una variable del repo).
 */
import { build } from "esbuild";
import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "release", "agente-local");
const detectorBuild = join(root, "dist", "detector");

function fail(message) {
  console.error(`[package] ${message}`);
  process.exit(1);
}

// --- Configuración del paquete ---------------------------------------------------------------

const rawOrigins = process.env.RELEASE_ALLOWED_ORIGINS?.trim();
if (!rawOrigins) fail("Falta RELEASE_ALLOWED_ORIGINS (URLs del shell y la Arena desplegados, separadas por coma).");
const origins = rawOrigins
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);
for (const origin of origins) {
  // Misma regla que src/config.ts: solo esquema y dominio, o el agente rechazaría a la Arena.
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    fail(`Origen inválido en RELEASE_ALLOWED_ORIGINS: "${origin}".`);
  }
  if (parsed.origin !== origin) fail(`"${origin}" debe ser solo esquema y dominio (por ejemplo ${parsed.origin}).`);
}

const port = process.env.RELEASE_AGENT_PORT?.trim() || "47800";
if (!/^\d+$/.test(port)) fail(`RELEASE_AGENT_PORT inválido: "${port}".`);

const detectorInfo = await stat(join(detectorBuild, "index.html")).catch(() => null);
if (!detectorInfo) fail("Falta dist/detector: ejecuta antes `pnpm run build` (el script package ya lo hace).");

// --- Armar la carpeta ------------------------------------------------------------------------

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// Un solo archivo con ws y @duelo/contracts dentro: el jugador no necesita node_modules.
await build({
  entryPoints: [join(root, "src", "index.ts")],
  outfile: join(outDir, "agente.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Opcionales de ws (aceleran en C++); sin ellos ws funciona igual.
  external: ["bufferutil", "utf-8-validate"],
  // ws es CommonJS y pide módulos de Node con require(): en ESM hay que darle un require real.
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  legalComments: "none",
  logLevel: "warning",
});

await cp(detectorBuild, join(outDir, "detector"), { recursive: true });

// CRLF: el .bat y los textos se abren en Windows (Bloc de notas, cmd).
const crlf = (lines) => lines.join("\r\n") + "\r\n";

await writeFile(
  join(outDir, ".env"),
  crlf([
    "# Configuración del agente local. No tiene secretos: el agente solo escucha en 127.0.0.1.",
    `AGENT_PORT=${port}`,
    `ALLOWED_ORIGINS=${origins.join(",")}`,
    "AGENT_DETECTOR_DIR=detector",
    "AGENT_OPEN_BROWSER=",
  ]),
);

// Solo ASCII en el .bat: cmd.exe no siempre muestra bien las tildes.
await writeFile(
  join(outDir, "Iniciar agente.bat"),
  crlf([
    "@echo off",
    "title Agente local - Duelo de hechiceros",
    'cd /d "%~dp0"',
    "where node >nul 2>nul",
    "if errorlevel 1 goto nonode",
    "set NODE_MAJOR=0",
    "for /f \"tokens=1 delims=v.\" %%v in ('node -v') do set NODE_MAJOR=%%v",
    "if %NODE_MAJOR% LSS 22 goto oldnode",
    "node --env-file=.env agente.mjs",
    "if errorlevel 1 pause",
    "exit /b",
    ":nonode",
    "echo No encontramos Node.js en este PC.",
    "echo Instala la version LTS (22 o superior) desde https://nodejs.org y vuelve a abrir este archivo.",
    "pause",
    "exit /b 1",
    ":oldnode",
    "echo Tu Node.js es muy antiguo. El agente necesita la version 22 o superior.",
    "echo Instala la version LTS desde https://nodejs.org y vuelve a abrir este archivo.",
    "pause",
    "exit /b 1",
  ]),
);

await writeFile(
  join(outDir, "LEEME.txt"),
  crlf([
    "Agente local de Duelo de hechiceros",
    "",
    "1. Requisito: Node.js 22 o superior (https://nodejs.org) y Chrome o Edge.",
    "2. Haz doble clic en \"Iniciar agente.bat\": se abre la ventana del detector.",
    "3. En esa ventana, permite la cámara y el micrófono.",
    "4. Abre el juego en el navegador y entra a la Arena: debe decir \"Agente local conectado\".",
    "5. Para cerrarlo, cierra la ventana negra del agente (o pulsa Ctrl+C en ella).",
    "",
    "Todo el reconocimiento ocurre en tu PC: al juego solo viajan eventos, nunca video ni audio.",
  ]),
);

console.log(`[package] Listo: ${outDir}`);
console.log(`[package] Orígenes permitidos: ${origins.join(", ")} · puerto ${port}`);
