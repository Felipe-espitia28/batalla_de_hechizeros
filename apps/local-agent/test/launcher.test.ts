import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appModeArgs, browserCandidates, launchDetector } from "../src/launcher.js";

describe("lanzador del detector", () => {
  it("en Windows prefiere Chrome y luego Edge, buscando en las carpetas de programas", () => {
    const local = join("C:", "Users", "jugador", "AppData", "Local");
    const chrome = join(local, "Google", "Chrome", "Application", "chrome.exe");
    const edge = join("C:", "PF86", "Microsoft", "Edge", "Application", "msedge.exe");
    const installed = new Set([chrome, edge]);
    const found = browserCandidates("win32", { PROGRAMFILES: join("C:", "PF"), "PROGRAMFILES(X86)": join("C:", "PF86"), LOCALAPPDATA: local }, (p) =>
      installed.has(p),
    );
    expect(found).toEqual([
      { name: "Chrome", command: chrome },
      { name: "Edge", command: edge },
    ]);
  });

  it("sin navegadores instalados no propone nada en Windows", () => {
    expect(browserCandidates("win32", { PROGRAMFILES: "C:\\PF" }, () => false)).toEqual([]);
  });

  it("abre el detector en modo app", () => {
    expect(appModeArgs("http://127.0.0.1:47800")[0]).toBe("--app=http://127.0.0.1:47800");
  });

  it("devuelve null si ningún navegador arranca (el agente imprime la URL)", async () => {
    const missing = [{ name: "Chrome", command: join("no", "existe", "chrome-falso") }];
    expect(await launchDetector("http://127.0.0.1:47800", missing)).toBeNull();
  });
});
