import { describe, expect, it } from "vitest";
import { ShoutDetector } from "../src/shout-detector";

const detector = () => new ShoutDetector({ ultimateId: "meteor", shoutThreshold: 0.12, windowMs: 2000, cooldownMs: 3000 });

describe("ShoutDetector (grito + palabra)", () => {
  it("grito y luego «¡Meteoro!» → definitivo con el texto reconocido", () => {
    const d = detector();
    d.feedLevel(0.3, 1000);
    expect(d.feedTranscript("¡Meteoro!", 1600)).toEqual({ ultimateId: "meteor", transcript: "¡Meteoro!" });
  });

  it("normaliza: mayúsculas y tildes no importan", () => {
    const d = detector();
    d.feedLevel(0.3, 0);
    expect(d.feedTranscript("METEÓRO", 500)).not.toBeNull();
  });

  it("decir la palabra sin gritar no lanza nada", () => {
    const d = detector();
    d.feedLevel(0.05, 1000);
    expect(d.feedTranscript("meteoro", 1200)).toBeNull();
  });

  it("gritar otra cosa no lanza nada; tampoco palabras que solo la contienen", () => {
    const d = detector();
    d.feedLevel(0.4, 1000);
    expect(d.feedTranscript("¡vamos!", 1200)).toBeNull();
    expect(d.feedTranscript("meteorológico", 1300)).toBeNull();
  });

  it("si el texto llega demasiado tarde tras el grito, no cuenta", () => {
    const d = detector();
    d.feedLevel(0.4, 1000);
    expect(d.feedTranscript("meteoro", 3500)).toBeNull();
  });

  it("Web Speech repite el texto (parcial y final): solo un definitivo por grito", () => {
    const d = detector();
    d.feedLevel(0.4, 1000);
    expect(d.feedTranscript("meteoro", 1300)).not.toBeNull();
    expect(d.feedTranscript("meteoro", 1500)).toBeNull();
  });

  it("respeta el definitivo equipado", () => {
    const d = detector();
    d.setUltimate("storm");
    d.feedLevel(0.4, 0);
    expect(d.feedTranscript("meteoro", 100)).toBeNull();
    expect(d.feedTranscript("¡Tormenta!", 200)).toEqual({ ultimateId: "storm", transcript: "¡Tormenta!" });
  });
});

describe("Palabras de los demás definitivos (P2), normalizadas", () => {
  it.each([
    ["storm", "¡TORMENTA!"],
    ["rebirth", "renacer"],
    ["purple-void", "¡Vacío!"],
    ["purple-void", "púrpura"],
  ] as const)("%s acepta «%s»", (ultimateId, said) => {
    const d = new ShoutDetector({ ultimateId, shoutThreshold: 0.12 });
    d.feedLevel(0.4, 0);
    expect(d.feedTranscript(said, 300)).toEqual({ ultimateId, transcript: said });
  });

  it("Vacío púrpura no se activa con «vaciar»", () => {
    const d = new ShoutDetector({ ultimateId: "purple-void" });
    d.feedLevel(0.4, 0);
    expect(d.feedTranscript("vaciar", 300)).toBeNull();
  });
});
