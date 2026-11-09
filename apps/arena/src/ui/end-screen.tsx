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
  const title = end.winnerId === null ? "Empate" : end.winnerId === userId ? "¡Victoria!" : "Derrota";
  const tone = end.winnerId === null ? "draw" : end.winnerId === userId ? "win" : "loss";

  return (
    <div className={`end end--${tone}`}>
      <h2 className="end__title">{title}</h2>
      <p className="muted">{END_REASON_MESSAGES[end.reason]}</p>
      {reward && (
        <dl className="end__rewards">
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
      )}
      <div className="row">
        <button className="btn btn--primary" onClick={onPlayAgain}>
          Jugar otra vez
        </button>
        <button className="btn" onClick={onExit}>
          Ver ranking
        </button>
      </div>
    </div>
  );
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
