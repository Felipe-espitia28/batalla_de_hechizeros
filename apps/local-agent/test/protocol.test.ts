// El protocolo vive en @duelo/contracts (que no tiene pruebas propias); se prueba aquí, donde se usa.
import { LOCAL_AGENT_SENDERS, parseLocalAgentMessage } from "@duelo/contracts";
import { describe, expect, it } from "vitest";

describe("protocolo del agente local", () => {
  it("acepta los mensajes del protocolo", () => {
    const spell = { type: "agent:spell", spellId: "lightning", confidence: 0.91 };
    expect(parseLocalAgentMessage(JSON.stringify(spell))).toEqual(spell);
  });

  it("descarta lo que no es JSON, no es objeto o tiene un tipo desconocido", () => {
    for (const raw of ["hola", "null", "42", "[]", '{"type":"combat:cast-spell"}', '{"type":"toString"}', "{}"]) {
      expect(parseLocalAgentMessage(raw)).toBeNull();
    }
  });

  it("solo la Arena configura y solo el detector emite hechizos", () => {
    expect(LOCAL_AGENT_SENDERS["agent:config"]).toBe("arena");
    expect(LOCAL_AGENT_SENDERS["agent:spell"]).toBe("detector");
    expect(LOCAL_AGENT_SENDERS["agent:peer"]).toBe("server");
  });
});
