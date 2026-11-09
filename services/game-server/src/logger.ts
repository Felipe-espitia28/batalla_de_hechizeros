/**
 * Logger mínimo. Render guarda stdout/stderr, así que no hace falta una librería de logs.
 * Se inyecta en el servicio para poder silenciarlo en los tests.
 */
export interface Logger {
  info(message: string, extra?: unknown): void;
  warn(message: string, extra?: unknown): void;
  error(message: string, extra?: unknown): void;
}

function line(level: string, message: string, extra: unknown): string {
  const suffix = extra === undefined ? "" : ` ${extra instanceof Error ? extra.message : JSON.stringify(extra)}`;
  return `${new Date().toISOString()} [game-server] ${level} ${message}${suffix}`;
}

export const consoleLogger: Logger = {
  info: (message, extra) => console.log(line("INFO", message, extra)),
  warn: (message, extra) => console.warn(line("WARN", message, extra)),
  error: (message, extra) => console.error(line("ERROR", message, extra)),
};

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
