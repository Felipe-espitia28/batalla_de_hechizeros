/**
 * Catálogo con el gesto, el efecto y la compra de cada hechizo.
 * La interfaz desactiva lo que no se puede comprar, pero quien decide es el servidor:
 * aquí solo se traduce cada respuesta (oro insuficiente, ya comprado…) a un mensaje claro.
 */
import type { AnySpellId, SpellCatalogItem } from "@duelo/contracts";
import { useState } from "react";
import { ShopApiError, type ShopApi } from "./api";
import { describeEffect, describeStats, getDefinition, getSpellStatus, type SpellStatus } from "./shop-logic";

interface CatalogViewProps {
  api: ShopApi;
  spells: SpellCatalogItem[];
  owned: ReadonlySet<string>;
  gold: number;
  onPurchased: (spellId: AnySpellId, gold: number) => void;
  /** El servidor informó el oro real (p. ej. en INSUFFICIENT_GOLD): se corrige el mostrado. */
  onGoldKnown: (gold: number) => void;
  /** El inventario local quedó desactualizado (ALREADY_OWNED): hay que recargarlo. */
  onOwnershipChanged: () => void;
}

type Feedback = { spellId: AnySpellId; kind: "ok" | "error"; text: string };

export function CatalogView(props: CatalogViewProps) {
  const { api, spells, owned, gold } = props;
  // Una compra a la vez: evita el doble clic en la interfaz (el servidor también lo impide).
  const [buying, setBuying] = useState<AnySpellId | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function buy(item: SpellCatalogItem) {
    setBuying(item.id);
    setFeedback(null);
    try {
      const result = await api.purchase(item.id);
      props.onPurchased(result.spellId, result.gold);
      setFeedback({ spellId: item.id, kind: "ok", text: `¡${item.name} es tuyo! Agrégalo a tu grimorio.` });
    } catch (error) {
      setFeedback({ spellId: item.id, kind: "error", text: purchaseErrorText(error, item, props) });
    } finally {
      setBuying(null);
    }
  }

  const sections: { title: string; hint: string; items: SpellCatalogItem[] }[] = [
    {
      title: "Hechizos",
      hint: "Se lanzan dibujando el gesto con la pinza. Rayo y Escudo siempre van en tu grimorio.",
      items: spells.filter((s) => s.kind === "spell"),
    },
    {
      title: "Definitivos",
      hint: "Cuestan 100 de maná y se activan gritando su nombre. Equipas uno a la vez.",
      items: spells.filter((s) => s.kind === "ultimate"),
    },
  ];

  return (
    <div className="t-catalog">
      {sections.map((section) => (
        <section key={section.title} aria-labelledby={`t-sec-${section.title}`}>
          <div className="t-section-head">
            <h3 id={`t-sec-${section.title}`}>{section.title}</h3>
            <p className="t-muted">{section.hint}</p>
          </div>
          <ul className="t-grid">
            {section.items.map((item) => {
              const status = getSpellStatus(item, owned, gold);
              const def = getDefinition(item.id);
              const message = feedback?.spellId === item.id ? feedback : null;
              return (
                <li key={item.id} className={`t-card t-card--${status}`}>
                  <div className="t-card-top">
                    <span className="t-emoji" aria-hidden="true">
                      {def.emoji}
                    </span>
                    <div>
                      <h4>{item.name}</h4>
                      <p className="t-gesture">{item.gestureDescription}</p>
                    </div>
                  </div>
                  <p>{describeEffect(def)}</p>
                  <p className="t-stats">{describeStats(def)}</p>
                  <div className="t-card-foot">
                    <PriceTag item={item} status={status} />
                    <BuyButton
                      status={status}
                      busy={buying === item.id}
                      disabled={buying !== null}
                      missing={item.price - gold}
                      onBuy={() => void buy(item)}
                    />
                  </div>
                  {message && (
                    <p className={`t-feedback t-feedback--${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
                      {message.text}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PriceTag({ item, status }: { item: SpellCatalogItem; status: SpellStatus }) {
  if (status === "starter") return <span className="t-badge">Inicial</span>;
  if (status === "owned") return <span className="t-badge t-badge--owned">Comprado</span>;
  return (
    <span className="t-price">
      <span aria-hidden="true">🪙</span> <span className="t-num">{item.price}</span>
    </span>
  );
}

function BuyButton(props: {
  status: SpellStatus;
  busy: boolean;
  disabled: boolean;
  missing: number;
  onBuy: () => void;
}) {
  switch (props.status) {
    case "starter":
    case "owned":
      return null;
    case "coming-soon":
      return (
        <button type="button" className="t-btn" disabled>
          Próximamente
        </button>
      );
    case "too-expensive":
      return (
        <button type="button" className="t-btn" disabled title="Gana oro en la Arena">
          Te faltan {props.missing}
        </button>
      );
    case "affordable":
      return (
        <button type="button" className="t-btn t-btn--primary" disabled={props.disabled} onClick={props.onBuy}>
          {props.busy ? "Comprando…" : "Comprar"}
        </button>
      );
  }
}

function purchaseErrorText(error: unknown, item: SpellCatalogItem, props: CatalogViewProps): string {
  if (!(error instanceof ShopApiError)) return "Algo salió mal. Inténtalo de nuevo.";
  switch (error.code) {
    case "INSUFFICIENT_GOLD": {
      // El oro mostrado estaba desactualizado (p. ej. se gastó en otra pestaña): se corrige.
      const details = error.details as { gold?: unknown } | undefined;
      if (typeof details?.gold === "number") props.onGoldKnown(details.gold);
      return error.message;
    }
    case "ALREADY_OWNED":
      props.onOwnershipChanged();
      return `Ya tenías ${item.name}.`;
    case "UNAUTHORIZED":
    case "TOKEN_EXPIRED":
      return "Tu sesión expiró. Vuelve a iniciar sesión.";
    default:
      return error.message;
  }
}
