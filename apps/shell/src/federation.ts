/**
 * Carga de remotes en tiempo de ejecución.
 *
 * Por qué no se declaran en vite.config.ts: así declarados, el arranque de Module Federation
 * espera a que TODOS los remoteEntry.js respondan antes de montar el shell, y un solo remote
 * caído deja la aplicación entera en blanco. Registrándolos al visitar su sección, cada remote
 * falla por separado y el resto del shell sigue funcionando (R7 y sección 11).
 */
import type { ComponentType } from "react";
import { loadRemote, registerRemotes } from "@module-federation/runtime";
import type { RemoteAppProps } from "@duelo/contracts";
import { config, type RemoteName } from "./config.js";

type RemoteModule = { default: ComponentType<RemoteAppProps> };

export class RemoteNotConfiguredError extends Error {
  constructor(readonly remote: RemoteName) {
    super(`El remote ${remote} no tiene URL configurada`);
    this.name = "RemoteNotConfiguredError";
  }
}

const registered = new Set<RemoteName>();

/**
 * Registra el remote y devuelve su App expuesto. En un reintento (`attempt` > 0) lo vuelve a
 * registrar con otra URL: el navegador guarda un import() fallido para siempre en esa página,
 * así que pedir la misma URL fallaría aunque el remote ya esté arriba.
 */
export async function loadRemoteApp(name: RemoteName, attempt = 0): Promise<RemoteModule> {
  const base = config.remotes[name];
  if (!base) throw new RemoteNotConfiguredError(name);

  if (!registered.has(name) || attempt > 0) {
    const entry = attempt > 0 ? `${base}/remoteEntry.js?intento=${attempt}` : `${base}/remoteEntry.js`;
    registerRemotes([{ name, entry, type: "module" }], { force: attempt > 0 });
    registered.add(name);
  }

  const module = await loadRemote<RemoteModule>(`${name}/App`);
  if (!module?.default) {
    throw new Error(`El remote ${name} no expone un componente App`);
  }
  return module;
}
