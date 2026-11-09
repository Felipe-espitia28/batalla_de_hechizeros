-- Integra el modelo de partidas de Daniel (ranking): el id de partida y el motivo de fin pasan a texto.
-- El id lo genera el game-server y es la clave de idempotencia de POST /internal/matches;
-- en texto acepta tanto UUID como ids tipo "m_8f2c41" (ejemplo de la sección 7).

-- DropForeignKey
ALTER TABLE "match_players" DROP CONSTRAINT "match_players_match_id_fkey";

-- AlterTable
ALTER TABLE "match_players" DROP CONSTRAINT "match_players_pkey",
ALTER COLUMN "match_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "match_players_pkey" PRIMARY KEY ("match_id", "user_id");

-- AlterTable: conversión de tipo (no DROP/ADD) para conservar las partidas ya registradas.
ALTER TABLE "matches" DROP CONSTRAINT "matches_pkey",
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "end_reason" SET DATA TYPE TEXT USING "end_reason"::TEXT,
ADD CONSTRAINT "matches_pkey" PRIMARY KEY ("id");

-- DropEnum
DROP TYPE "EndReason";

-- Sin el enum, la base sigue garantizando los cuatro motivos de fin de la sección 7.
ALTER TABLE "matches" ADD CONSTRAINT "matches_end_reason_valid"
  CHECK ("end_reason" IN ('KO', 'TIMEOUT', 'DRAW', 'ABANDON'));

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
