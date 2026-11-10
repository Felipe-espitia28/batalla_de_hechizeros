import type { MatchEndPayload, UserId } from "@duelo/contracts";
import { END_REASON_MESSAGES } from "../match/messages";

interface Props {
  end: MatchEndPayload;
  userId: UserId;
  onPlayAgain: () => void;
  onExit: () => void;
}

export function EndScreen({ end, userId, onPlayAgain, onExit }: Props) {
  const reward = end.rewards[userId];
  // Sin recompensas = el servidor canceló la partida (nadie confirmó la calibración).
  if (!reward) {
    return (
      <div className="ar-end ar-end--draw">
        <h2 className="ar-end__title">Partida cancelada</h2>
        <p className="ar-muted">Ningún jugador confirmó a tiempo. No cuenta para el ranking.</p>
        <div className="ar-row">
          <button className="ar-btn ar-btn--primary" onClick={onPlayAgain}>
            Buscar otra partida
          </button>
        </div>
      </div>
    );
  }

  const title = end.winnerId === null ? "Empate" : end.winnerId === userId ? "¡Victoria!" : "Derrota";
  const tone = end.winnerId === null ? "draw" : end.winnerId === userId ? "win" : "loss";

  return (
    <div className={`ar-end ar-end--${tone}`}>
      <h2 className="ar-end__title">{title}</h2>
      <p className="ar-muted">{END_REASON_MESSAGES[end.reason]}</p>
      <dl className="ar-end__rewards">
        <div>
          <dt>Puntos de rango</dt>
          <dd>
            {signed(reward.ratingDelta)} → {reward.newRating} ({reward.newRank})
          </dd>
        </div>
        <div>
          <dt>Oro arcano</dt>
          <dd>{signed(reward.goldDelta)}</dd>
        </div>
      </dl>
      <div className="ar-row">
        <button className="ar-btn ar-btn--primary" onClick={onPlayAgain}>
          Jugar otra vez
        </button>
        <button className="ar-btn" onClick={onExit}>
          Ver ranking
        </button>
      </div>
    </div>
  );
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
