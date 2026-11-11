/**
 * Editor del grimorio (sección 6): Rayo y Escudo fijos en los espacios 1 y 2, dos espacios libres
 * para hechizos comprados y uno aparte para el definitivo. Los selectores solo ofrecen lo que el
 * api aceptaría; si aun así rechaza (inventario cambiado en otra pestaña), se marca el espacio.
 *
 * Lo que se guarda aquí es lo único que cuenta en combate: el game-server lo pide al api,
 * nunca lo recibe de la Arena.
 */
import type { Grimoire, SpellId, UltimateId } from "@duelo/contracts";
import { useState } from "react";
import { ShopApiError, type ShopApi } from "./api";
import { getDefinition, grimoireErrorsByField, sameGrimoire, slotOptions, ultimateOptions } from "./shop-logic";

interface GrimoireEditorProps {
  api: ShopApi;
  owned: ReadonlySet<string>;
  saved: Grimoire;
  onSaved: (grimoire: Grimoire) => void;
  onGoToCatalog: () => void;
  onPlay: () => void;
}

type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

const label = (id: SpellId | UltimateId) => {
  const def = getDefinition(id);
  return `${def.emoji} ${def.name}`;
};

export function GrimoireEditor({ api, owned, saved, onSaved, onGoToCatalog, onPlay }: GrimoireEditorProps) {
  const [draft, setDraft] = useState<Grimoire>(saved);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const dirty = !sameGrimoire(draft, saved);
  const freeSlotChoices = slotOptions(owned, { ...draft, slots: [draft.slots[0], draft.slots[1], null, null] }, 2);

  function setSlot(index: 2 | 3, value: string) {
    const slots: Grimoire["slots"] = [...draft.slots];
    slots[index] = value === "" ? null : (value as SpellId);
    setDraft({ ...draft, slots });
    setSave({ status: "idle" });
    setFieldErrors({});
  }

  function setUltimate(value: UltimateId) {
    setDraft({ ...draft, ultimateId: value });
    setSave({ status: "idle" });
    setFieldErrors({});
  }

  async function submit() {
    setSave({ status: "saving" });
    setFieldErrors({});
    try {
      const result = await api.saveGrimoire(draft);
      setDraft(result);
      onSaved(result);
      setSave({ status: "saved" });
    } catch (error) {
      if (error instanceof ShopApiError && error.code === "INVALID_GRIMOIRE") {
        setFieldErrors(grimoireErrorsByField(error.details));
      }
      setSave({ status: "error", message: error instanceof Error ? error.message : "No se pudo guardar" });
    }
  }

  return (
    <div className="t-grimoire">
      <section className="t-panel" aria-labelledby="t-grimoire-spells">
        <div className="t-section-head">
          <h3 id="t-grimoire-spells">Hechizos</h3>
          <p className="t-muted">En combate, el reconocedor solo compara tu trazo con estos cuatro gestos.</p>
        </div>
        <ol className="t-slots">
          {([0, 1] as const).map((index) => (
            <li key={index} className="t-slot t-slot--fixed">
              <span className="t-slot-num">{index + 1}</span>
              <span>{label(draft.slots[index])}</span>
              <span className="t-badge">Fijo</span>
            </li>
          ))}
          {([2, 3] as const).map((index) => {
            const current = draft.slots[index];
            const options = slotOptions(owned, draft, index);
            const error = fieldErrors[`slots.${index}`];
            return (
              <li key={index} className={`t-slot${error ? " t-slot--invalid" : ""}`}>
                <span className="t-slot-num">{index + 1}</span>
                <label className="t-sr-only" htmlFor={`t-slot-${index}`}>
                  Espacio {index + 1}
                </label>
                <select
                  id={`t-slot-${index}`}
                  value={current ?? ""}
                  onChange={(event) => setSlot(index, event.target.value)}
                  disabled={save.status === "saving"}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `t-slot-${index}-error` : undefined}
                >
                  <option value="">— Vacío —</option>
                  {/* Si el guardado tiene algo que ya no está entre las opciones, se muestra igual para no ocultarlo. */}
                  {current && !options.includes(current) && <option value={current}>{label(current)}</option>}
                  {options.map((id) => (
                    <option key={id} value={id}>
                      {label(id)}
                    </option>
                  ))}
                </select>
                {error && (
                  <span id={`t-slot-${index}-error`} className="t-field-error">
                    {error}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {freeSlotChoices.length === 0 && (
          <p className="t-hint">
            Aún no tienes hechizos para los espacios 3 y 4.{" "}
            <button type="button" className="t-link" onClick={onGoToCatalog}>
              Ve al catálogo
            </button>
            .
          </p>
        )}
      </section>

      <section className="t-panel" aria-labelledby="t-grimoire-ultimate">
        <div className="t-section-head">
          <h3 id="t-grimoire-ultimate">Definitivo</h3>
          <p className="t-muted">Grita su nombre con el maná lleno.</p>
        </div>
        <div className="t-ultimates" role="radiogroup" aria-labelledby="t-grimoire-ultimate">
          {ultimateOptions(owned).map((id) => (
            <label key={id} className={`t-ultimate${draft.ultimateId === id ? " t-ultimate--active" : ""}`}>
              <input
                type="radio"
                name="t-ultimate"
                value={id}
                checked={draft.ultimateId === id}
                onChange={() => setUltimate(id)}
                disabled={save.status === "saving"}
              />
              {label(id)}
            </label>
          ))}
        </div>
        {fieldErrors["ultimateId"] && <p className="t-field-error">{fieldErrors["ultimateId"]}</p>}
      </section>

      <div className="t-actions">
        <button
          type="button"
          className="t-btn t-btn--primary"
          disabled={!dirty || save.status === "saving"}
          onClick={() => void submit()}
        >
          {save.status === "saving" ? "Guardando…" : "Guardar grimorio"}
        </button>
        {dirty && save.status !== "saving" && (
          <button
            type="button"
            className="t-btn"
            onClick={() => {
              setDraft(saved);
              setFieldErrors({});
              setSave({ status: "idle" });
            }}
          >
            Descartar cambios
          </button>
        )}
        {save.status === "saved" && (
          <p className="t-feedback t-feedback--ok" role="status">
            Grimorio guardado. Se usará en tu próxima partida.{" "}
            <button type="button" className="t-link" onClick={onPlay}>
              Ir a la Arena
            </button>
          </p>
        )}
        {save.status === "error" && (
          <p className="t-feedback t-feedback--error" role="alert">
            {save.message}
          </p>
        )}
      </div>
    </div>
  );
}
