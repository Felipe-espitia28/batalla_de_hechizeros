/**
 * Remote Ranking: el componente que expone Module Federation y que el shell monta con
 * `session` y `navigate` (sección 9). También corre solo con una sesión de prueba (main.tsx).
 */
import type { MatchHistoryItem, RankName, RankingEntry, RankingMeResponse, RemoteAppProps } from "@duelo/contracts";
import { useMemo } from "react";
import { createRankingApi } from "./api";
import { API_URL } from "./config";
import {
  END_REASON_LABELS,
  RESULT_LABELS,
  formatDate,
  formatDelta,
  formatDuration,
  nextRankProgress,
} from "./format";
import { useRankingData } from "./use-ranking-data";
import "./ranking.css";

export default function App({ session, navigate }: RemoteAppProps) {
  if (!API_URL) {
    return (
      <div className="ranking">
        <div className="rk-panel rk-error" role="alert">
          Falta configurar <code>VITE_API_URL</code> en el .env del Ranking.
        </div>
      </div>
    );
  }
  // key: si cambia el usuario o el token se descartan los datos del anterior.
  return <Ranking key={`${session.user.id}:${session.token}`} session={session} navigate={navigate} />;
}

function Ranking({ session, navigate }: RemoteAppProps) {
  const api = useMemo(() => createRankingApi(API_URL), []);
  const { data, error, loading, slow, reload } = useRankingData(api, session);

  return (
    <div className="ranking">
      <header className="rk-header">
        <div>
          <p className="rk-eyebrow">Ranking global</p>
          <h1>Los mejores hechiceros</h1>
        </div>
        <button type="button" className="rk-button" onClick={() => void reload()} disabled={loading}>
          {loading && data ? "Actualizando…" : "Actualizar"}
        </button>
      </header>

      {!data && loading && <LoadingState slow={slow} />}

      {!data && !loading && error && (
        <div className="rk-panel rk-error" role="alert">
          <p>{error.message}</p>
          <button type="button" className="rk-button" onClick={() => void reload()}>
            Reintentar
          </button>
        </div>
      )}

      {data && (
        <>
          {error && (
            <p className="rk-banner" role="status">
              No se pudo actualizar: {error.message} Se muestran los últimos datos cargados.
            </p>
          )}
          <div className="rk-grid">
            <MyCard me={data.me} username={session.user.username} onPlay={() => navigate("/arena")} />
            <TopTable entries={data.top} myId={session.user.id} />
            <History matches={data.history} onPlay={() => navigate("/arena")} />
          </div>
        </>
      )}
    </div>
  );
}

function LoadingState({ slow }: { slow: boolean }) {
  return (
    <div className="rk-panel rk-loading" aria-live="polite">
      <span className="rk-spinner" aria-hidden="true" />
      <p>Cargando el ranking…</p>
      {slow && (
        <p className="rk-muted">
          El servidor está despertando (en el plan gratuito tarda hasta un minuto). No cierres la página.
        </p>
      )}
    </div>
  );
}

/** `hero`: la variante de "Tu posición" del diseño; en la tabla cada grado tiene su color. */
function RankBadge({ rank, hero = false }: { rank: RankName; hero?: boolean }) {
  const tone = hero ? "hero" : rank === "Grado Especial" ? "special" : rank.replace("Grado ", "g");
  return <span className={`rk-rank rk-rank--${tone}`}>{rank}</span>;
}

function MyCard({ me, username, onPlay }: { me: RankingMeResponse; username: string; onPlay: () => void }) {
  const progress = nextRankProgress(me.rating);
  return (
    <section className="rk-panel rk-me" aria-labelledby="rk-me-title">
      <h2 id="rk-me-title">Tu posición</h2>
      <div className="rk-me__summary">
        <p className="rk-me__name">{username}</p>
        <p className="rk-me__position">
          <span className="rk-me__number rk-num">#{me.position}</span>
          <span className="rk-me__total">de {me.totalPlayers}</span>
        </p>
        <p className="rk-me__rating">
          <RankBadge rank={me.rank} hero />
          <span className="rk-num">{me.rating} puntos</span>
        </p>
      </div>
      <div className="rk-me__progress">
        <p className="rk-muted">
          {progress ? `Te faltan ${progress.missing} puntos para ${progress.next}.` : "Estás en el rango más alto."}
        </p>
        <div
          className="rk-progress"
          role="progressbar"
          aria-label={progress ? `Avance hacia ${progress.next}` : "Rango máximo alcanzado"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((progress?.percent ?? 1) * 100)}
        >
          <div className="rk-progress__fill" style={{ width: `${(progress?.percent ?? 1) * 100}%` }} />
        </div>
      </div>
      <button type="button" className="rk-button rk-button--primary rk-button--block" onClick={onPlay}>
        Ir a la Arena
      </button>
    </section>
  );
}

function TopTable({ entries, myId }: { entries: RankingEntry[]; myId: string }) {
  return (
    <section className="rk-panel rk-top" aria-labelledby="rk-top-title">
      <h2 id="rk-top-title">Top {entries.length}</h2>
      {entries.length === 0 ? (
        <p className="rk-muted">Todavía no hay jugadores en el ranking.</p>
      ) : (
        <table className="rk-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Hechicero</th>
              <th scope="col">Rango</th>
              <th scope="col" className="rk-right">
                Puntos
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const isMe = entry.userId === myId;
              const rowClass = [isMe && "rk-row--me", entry.position === 1 && "rk-row--first"].filter(Boolean).join(" ");
              return (
              <tr key={entry.userId} className={rowClass || undefined}>
                <td className="rk-num rk-pos-cell">{entry.position}</td>
                <td className="rk-name-cell">
                  {entry.username}
                  {isMe && <span className="rk-you">(tú)</span>}
                </td>
                <td>
                  <RankBadge rank={entry.rank} />
                </td>
                <td className="rk-num rk-right rk-points-cell">{entry.rating}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function History({ matches, onPlay }: { matches: MatchHistoryItem[]; onPlay: () => void }) {
  return (
    <section className="rk-panel rk-history" aria-labelledby="rk-history-title">
      <h2 id="rk-history-title">Tus últimas partidas</h2>
      {matches.length === 0 ? (
        <div className="rk-empty">
          <p className="rk-muted">Aún no has jugado ninguna partida.</p>
          <button type="button" className="rk-button" onClick={onPlay}>
            Jugar la primera
          </button>
        </div>
      ) : (
        <ul className="rk-matches">
          {matches.map((match) => (
            <li key={match.matchId} className={`rk-match rk-match--${match.result}`}>
              <span className="rk-match__result">{RESULT_LABELS[match.result]}</span>
              <span className="rk-match__info">
                <span className="rk-match__rival">vs {match.rival.username}</span>
                <span className="rk-match__meta">
                  {END_REASON_LABELS[match.endReason]} · {formatDuration(match.durationMs)} · {formatDate(match.endedAt)}
                </span>
              </span>
              <span className="rk-match__deltas">
                <span className={`rk-num ${match.ratingDelta < 0 ? "rk-neg" : match.ratingDelta > 0 ? "rk-pos" : ""}`}>
                  {formatDelta(match.ratingDelta)} pts
                </span>
                <span className="rk-num rk-gold">{formatDelta(match.goldDelta)} oro</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
