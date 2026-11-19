import { describe, expect, it } from "vitest";
import { ConfigError, detectorUrl, loadConfig } from "../src/config.js";

const ARENA = "https://arena.example.test";

describe("loadConfig", () => {
  it("lee el puerto y los orígenes, y abre el navegador por defecto", () => {
    const config = loadConfig({ AGENT_PORT: "47800", ALLOWED_ORIGINS: ` ${ARENA}/ , http://localhost:5174` });
    expect(config).toEqual({ port: 47800, allowedOrigins: [ARENA, "http://localhost:5174"], openBrowser: true, detectorDir: null });
  });

  it("no abre el navegador con AGENT_OPEN_BROWSER=false", () => {
    expect(loadConfig({ AGENT_PORT: "47800", ALLOWED_ORIGINS: ARENA, AGENT_OPEN_BROWSER: "FALSE" }).openBrowser).toBe(false);
  });

  it("lee la carpeta del detector del ZIP (AGENT_DETECTOR_DIR)", () => {
    expect(loadConfig({ AGENT_PORT: "47800", ALLOWED_ORIGINS: ARENA, AGENT_DETECTOR_DIR: " detector " }).detectorDir).toBe("detector");
  });

  it("nombra todas las variables que faltan", () => {
    expect(() => loadConfig({})).toThrow(/AGENT_PORT, ALLOWED_ORIGINS/);
  });

  it("rechaza puertos fuera de rango o no numéricos", () => {
    for (const AGENT_PORT of ["80", "70000", "abc", "47800.5"]) {
      expect(() => loadConfig({ AGENT_PORT, ALLOWED_ORIGINS: ARENA })).toThrow(ConfigError);
    }
  });

  it("rechaza orígenes con ruta o sin esquema", () => {
    expect(() => loadConfig({ AGENT_PORT: "47800", ALLOWED_ORIGINS: `${ARENA}/arena` })).toThrow(/solo esquema/);
    expect(() => loadConfig({ AGENT_PORT: "47800", ALLOWED_ORIGINS: "arena.example.test" })).toThrow(/inválido/);
  });

  it("el detector vive en 127.0.0.1, nunca en una IP de la red", () => {
    expect(detectorUrl({ port: 47800 })).toBe("http://127.0.0.1:47800");
  });
});
