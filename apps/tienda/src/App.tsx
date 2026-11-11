/**
 * Remote Tienda: el componente que expone Module Federation y que el shell monta con
 * `session` y `navigate` (sección 9). También corre solo con una sesión de prueba (main.tsx).
 *
 * Carga catálogo, inventario y oro; la compra y el grimorio viven en sus componentes.
 * Comunicación con el shell solo por CustomEvents: duelo:gold-changed tras comprar y
 * duelo:session-expired ante un 401. Nada de estado compartido.
 */
import {
  emitDueloEvent,
  type AnySpellId,
  type Grimoire,
  type InventoryResponse,
  type RemoteAppProps,
  type SpellCatalogItem,
} from "@duelo/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ShopApi, ShopApiError } from "./api";
import { CatalogView } from "./catalog-view";
import { API_URL } from "./config";
import { GrimoireEditor } from "./grimoire-editor";
import "./tienda.css";

export default function App(props: RemoteAppProps) {
  if (!API_URL) {
    return (
      <div className="tienda">
        <div className="t-panel t-error" role="alert">
          Falta configurar <code>VITE_API_URL</code> en el .env de la Tienda.
        </div>
      </div>
    );
  }
  // key: si cambia el usuario o el token se descarta todo lo cargado con la sesión anterior.
  return <Shop key={`${props.session.user.id}:${props.session.token}`} {...props} />;
}

type Tab = "catalog" | "grimoire";

interface ShopData {
  spells: SpellCatalogItem[];
  inventory: InventoryResponse;
  gold: number;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: ShopData }
  | { status: "error"; message: string }
  | { status: "expired" };

function Shop({ session, navigate }: RemoteAppProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [tab, setTab] = useState<Tab>("catalog");

  const api = useMemo(
    () =>
      new ShopApi({
        baseUrl: API_URL,
        token: session.token,
        onSessionExpired: () => {
          setState({ status: "expired" });
          emitDueloEvent("duelo:session-expired", {});
        },
      }),
    [session.token],
  );

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [spells, inventory, me] = await Promise.all([api.getSpells(), api.getInventory(), api.getMe()]);
      setState({ status: "ready", data: { spells: spells.spells, inventory, gold: me.gold } });
    } catch (error) {
      // El 401 ya cambió el estado a "expired" desde onSessionExpired.
      if (error instanceof ShopApiError && error.status === 401) return;
      setState({ status: "error", message: error instanceof Error ? error.message : "Error desconocido" });
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Actualiza solo lo cargado; si no hay datos (error o cargando) no hace nada. */
  const update = useCallback((change: (data: ShopData) => ShopData) => {
    setState((current) => (current.status === "ready" ? { status: "ready", data: change(current.data) } : current));
  }, []);

  const onPurchased = useCallback(
    (spellId: AnySpellId, gold: number) => {
      update((data) => ({
        ...data,
        gold,
        inventory: {
          ...data.inventory,
          items: [
            ...data.inventory.items,
            { spellId, pricePaid: data.spells.find((s) => s.id === spellId)?.price ?? 0, acquiredAt: new Date().toISOString() },
          ],
        },
      }));
      // El shell muestra el oro en la barra: se le avisa con el valor que devolvió el servidor.
      emitDueloEvent("duelo:gold-changed", { gold });
    },
    [update],
  );

  const onGoldKnown = useCallback((gold: number) => update((data) => ({ ...data, gold })), [update]);

  const onGrimoireSaved = useCallback(
    (grimoire: Grimoire) => update((data) => ({ ...data, inventory: { ...data.inventory, grimoire } })),
    [update],
  );

  if (state.status === "expired") {
    return (
      <div className="tienda">
        <div className="t-panel t-center" role="alert">
          <h2>Tu sesión expiró</h2>
          <p className="t-muted">Vuelve a iniciar sesión para usar la Tienda.</p>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="tienda">
        <div className="t-panel t-center" aria-live="polite">
          <span className="t-spinner" aria-hidden="true" />
          <p className="t-muted">Abriendo la Tienda…</p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="tienda">
        <div className="t-panel t-center t-error" role="alert">
          <h2>No se pudo cargar la Tienda</h2>
          <p>{state.message}</p>
          <button type="button" className="t-btn t-btn--primary" onClick={() => void load()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const { data } = state;
  const owned = new Set<string>(data.inventory.items.map((item) => item.spellId));

  return (
    <div className="tienda">
      <header className="t-header">
        <div>
          <p className="t-eyebrow">Tienda arcana</p>
          <h2>Hola, {session.user.username}</h2>
        </div>
        <p className="t-gold" aria-label={`Oro arcano: ${data.gold}`}>
          <span aria-hidden="true">🪙</span> <strong className="t-num">{data.gold}</strong> oro
        </p>
      </header>

      <nav className="t-tabs" role="tablist" aria-label="Secciones de la Tienda">
        <button type="button" role="tab" aria-selected={tab === "catalog"} onClick={() => setTab("catalog")}>
          Catálogo
        </button>
        <button type="button" role="tab" aria-selected={tab === "grimoire"} onClick={() => setTab("grimoire")}>
          Grimorio
        </button>
      </nav>

      {tab === "catalog" ? (
        <CatalogView
          api={api}
          spells={data.spells}
          owned={owned}
          gold={data.gold}
          onPurchased={onPurchased}
          onGoldKnown={onGoldKnown}
          onOwnershipChanged={() => void load()}
        />
      ) : (
        <GrimoireEditor
          api={api}
          owned={owned}
          saved={data.inventory.grimoire}
          onSaved={onGrimoireSaved}
          onGoToCatalog={() => setTab("catalog")}
          onPlay={() => navigate("/arena")}
        />
      )}
    </div>
  );
}
