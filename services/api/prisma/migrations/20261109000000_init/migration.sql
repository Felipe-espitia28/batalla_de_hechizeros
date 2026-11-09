-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SpellKind" AS ENUM ('spell', 'ultimate');

-- CreateEnum
CREATE TYPE "EndReason" AS ENUM ('KO', 'TIMEOUT', 'DRAW', 'ABANDON');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 0,
    "gold" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "equipped_ultimate_id" TEXT NOT NULL DEFAULT 'meteor',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spells" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SpellKind" NOT NULL,
    "gesture_description" TEXT NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,
    "is_starter" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "spells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_spells" (
    "user_id" UUID NOT NULL,
    "spell_id" TEXT NOT NULL,
    "price_paid" INTEGER NOT NULL DEFAULT 0,
    "acquired_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_spells_pkey" PRIMARY KEY ("user_id","spell_id")
);

-- CreateTable
CREATE TABLE "grimoire_slots" (
    "user_id" UUID NOT NULL,
    "slot" INTEGER NOT NULL,
    "spell_id" TEXT NOT NULL,

    CONSTRAINT "grimoire_slots_pkey" PRIMARY KEY ("user_id","slot")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "end_reason" "EndReason" NOT NULL,
    "winner_id" UUID,
    "duration_ms" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_players" (
    "match_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rating_before" INTEGER NOT NULL,
    "rating_delta" INTEGER NOT NULL,
    "gold_delta" INTEGER NOT NULL,
    "final_hp" INTEGER NOT NULL,

    CONSTRAINT "match_players_pkey" PRIMARY KEY ("match_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_rating_idx" ON "users"("rating" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "grimoire_slots_user_id_spell_id_key" ON "grimoire_slots"("user_id", "spell_id");

-- CreateIndex
CREATE INDEX "match_players_user_id_idx" ON "match_players"("user_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_equipped_ultimate_id_fkey" FOREIGN KEY ("equipped_ultimate_id") REFERENCES "spells"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_spells" ADD CONSTRAINT "user_spells_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_spells" ADD CONSTRAINT "user_spells_spell_id_fkey" FOREIGN KEY ("spell_id") REFERENCES "spells"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grimoire_slots" ADD CONSTRAINT "grimoire_slots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grimoire_slots" ADD CONSTRAINT "grimoire_slots_spell_id_fkey" FOREIGN KEY ("spell_id") REFERENCES "spells"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restricciones que Prisma no expresa en el esquema (sección 8 de CLAUDE.md).
-- La base es la última defensa: aunque un bug del api lo intente, el oro y el rating no quedan negativos.
ALTER TABLE "users" ADD CONSTRAINT "users_rating_non_negative" CHECK ("rating" >= 0);
ALTER TABLE "users" ADD CONSTRAINT "users_gold_non_negative" CHECK ("gold" >= 0);
ALTER TABLE "spells" ADD CONSTRAINT "spells_price_non_negative" CHECK ("price" >= 0);
ALTER TABLE "grimoire_slots" ADD CONSTRAINT "grimoire_slots_slot_range" CHECK ("slot" BETWEEN 1 AND 4);
