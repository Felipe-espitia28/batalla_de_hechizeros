/**
 * Selector de hechizo de los espacios 3 y 4 del grimorio, con los iconos del diseño.
 *
 * Reemplaza a un <select> nativo porque el navegador no puede mostrar imágenes dentro de sus
 * opciones. Sigue el patrón ARIA de listbox: botón con aria-haspopup/aria-expanded y una lista
 * role="listbox" que se maneja con el teclado (↑ ↓ Inicio Fin Enter Espacio Escape Tab).
 */
import type { SpellId } from "@duelo/contracts";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { getDefinition } from "./shop-logic";
import { SpellIcon, UiIcon } from "./spell-icon";

interface SpellPickerProps {
  id: string;
  value: SpellId | null;
  options: readonly SpellId[];
  onChange: (value: SpellId | null) => void;
  disabled?: boolean;
  /** id de la etiqueta "Espacio N" (aria-labelledby). */
  labelId: string;
  /** id del mensaje de error del campo, si lo hay. */
  errorId?: string;
}

export function SpellPicker({ id, value, options, onChange, disabled = false, labelId, errorId }: SpellPickerProps) {
  // Si lo guardado ya no está entre las opciones, se muestra igual para no ocultarlo.
  const items: (SpellId | null)[] = [null, ...(value && !options.includes(value) ? [value] : []), ...options];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-opcion-${index}`;

  function openList() {
    if (disabled) return;
    setActive(Math.max(0, items.indexOf(value)));
    setOpen(true);
  }

  function close(focusButton: boolean) {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  }

  function choose(index: number) {
    onChange(items[index] ?? null);
    close(true);
  }

  // Al abrir, el foco pasa a la lista; la opción activa se mantiene a la vista.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  // Clic fuera del selector: se cierra sin elegir.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openList();
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const last = items.length - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((i) => Math.min(last, i + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(last);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(active);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div className={`t-select${value ? "" : " t-select--empty"}${open ? " t-select--open" : ""}`} ref={rootRef}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className="t-select__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${id}`}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onButtonKeyDown}
      >
        {value && (
          <span className="t-select__icon-slot">
            <SpellIcon id={value} />
          </span>
        )}
        <span className="t-select__value">{value ? getDefinition(value).name : "— Vacío —"}</span>
        <UiIcon name="desplegar" size={16} className="t-select__chevron" />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          className="t-select__list"
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-activedescendant={optionId(active)}
          onKeyDown={onListKeyDown}
        >
          {items.map((spellId, index) => (
            <li
              key={spellId ?? "vacio"}
              id={optionId(index)}
              role="option"
              aria-selected={spellId === value}
              className={`t-select__option${index === active ? " t-select__option--active" : ""}`}
              onPointerEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              {/* Hueco fijo: los iconos miden 22 o 26 px y así los nombres quedan alineados. */}
              <span className="t-select__icon-slot" aria-hidden="true">
                {spellId && <SpellIcon id={spellId} />}
              </span>
              <span>{spellId ? getDefinition(spellId).name : "— Vacío —"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
