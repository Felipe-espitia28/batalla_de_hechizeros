/**
 * Abre la ventana del detector en Chrome (o Edge) en "modo app": una ventana propia, sin barra
 * de direcciones, que el jugador pone al lado de la Arena.
 *
 * Por qué Chrome/Edge y no Electron: MediaPipe necesita un navegador y Web Speech (los definitivos)
 * no funciona en Electron. Si no se encuentra ninguno, se imprime la URL para abrirla a mano.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface BrowserCandidate {
  name: string;
  /** Ruta absoluta o nombre de comando del PATH. */
  command: string;
}

/** Candidatos en orden de preferencia según el sistema. Chrome primero: es donde probamos la voz. */
export function browserCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): BrowserCandidate[] {
  if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(
      (root): root is string => Boolean(root),
    );
    const found: BrowserCandidate[] = [];
    for (const [name, relative] of [
      ["Chrome", ["Google", "Chrome", "Application", "chrome.exe"]],
      ["Edge", ["Microsoft", "Edge", "Application", "msedge.exe"]],
    ] as const) {
      for (const root of roots) {
        const path = join(root, ...relative);
        if (exists(path)) {
          found.push({ name, command: path });
          break;
        }
      }
    }
    return found;
  }
  if (platform === "darwin") {
    return [
      { name: "Chrome", command: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
      { name: "Edge", command: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
    ].filter((candidate) => exists(candidate.command));
  }
  // Linux: se prueban los comandos habituales; spawn falla con ENOENT si no existen.
  return [
    { name: "Chrome", command: "google-chrome" },
    { name: "Chromium", command: "chromium" },
    { name: "Chromium", command: "chromium-browser" },
  ];
}

/** Argumentos del modo app. El tamaño deja sitio a la Arena en una pantalla de portátil. */
export function appModeArgs(url: string): string[] {
  return [`--app=${url}`, "--new-window", "--window-size=520,760"];
}

/**
 * Intenta abrir el detector. Devuelve el navegador usado, o null si no hubo forma
 * (quien llama imprime la URL). El navegador queda independiente: cerrar el agente no lo cierra.
 */
export async function launchDetector(url: string, candidates = browserCandidates()): Promise<string | null> {
  for (const candidate of candidates) {
    if (await trySpawn(candidate.command, appModeArgs(url))) return candidate.name;
  }
  return null;
}

function trySpawn(command: string, args: string[]): Promise<boolean> {
  return new Promise((done) => {
    let child;
    try {
      child = spawn(command, args, { detached: true, stdio: "ignore" });
    } catch {
      done(false);
      return;
    }
    // "error" llega si el ejecutable no existe; "spawn" si arrancó.
    child.once("error", () => done(false));
    child.once("spawn", () => {
      child.unref();
      done(true);
    });
  });
}
