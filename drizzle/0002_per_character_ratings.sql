CREATE TABLE "mock_cfn_character" (
	"cfn_user_id" text NOT NULL,
	"character_key" text NOT NULL,
	"character_name" text NOT NULL,
	"league_points" integer NOT NULL,
	"master_rate" integer
);
--> statement-breakpoint
CREATE TABLE "player_character_rating" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"character_key" text NOT NULL,
	"character_name" text NOT NULL,
	"rank" text,
	"rank_tier" text,
	"rating_system" text,
	"league_points" integer,
	"master_rate" integer,
	"phase" integer,
	"observed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_character_baseline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"character_key" text NOT NULL,
	"character_name" text NOT NULL,
	"source" text NOT NULL,
	"initial_rank" text,
	"initial_rank_tier" text,
	"initial_rating_system" text,
	"initial_league_points" integer,
	"initial_master_rate" integer,
	"initial_phase" integer,
	"final_rank" text,
	"final_rank_tier" text,
	"final_rating_system" text,
	"final_league_points" integer,
	"final_master_rate" integer,
	"final_phase" integer,
	"captured_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_session" ADD COLUMN "rating_model" text DEFAULT 'per_character' NOT NULL;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "character_key" text;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "opponent_character_key" text;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "rating_before_system" text;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "rating_before_value" integer;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "rating_before_rank" text;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "rating_before_phase" integer;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "rating_after_system" text;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "rating_after_value" integer;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "rating_after_rank" text;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "rating_after_rank_tier" text;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "rating_after_phase" integer;--> statement-breakpoint
ALTER TABLE "mock_cfn_match" ADD COLUMN "character_key" text;--> statement-breakpoint
ALTER TABLE "mock_cfn_match" ADD COLUMN "rating_before_system" text;--> statement-breakpoint
ALTER TABLE "mock_cfn_match" ADD COLUMN "rating_before_value" integer;--> statement-breakpoint
ALTER TABLE "mock_cfn_match" ADD COLUMN "rating_after_system" text;--> statement-breakpoint
ALTER TABLE "mock_cfn_match" ADD COLUMN "rating_after_value" integer;--> statement-breakpoint
ALTER TABLE "mock_cfn_player" ADD COLUMN "favorite_character_key" text;--> statement-breakpoint
ALTER TABLE "mock_cfn_player" ADD COLUMN "current_character_key" text;--> statement-breakpoint
ALTER TABLE "sf6_player" ADD COLUMN "favorite_character_key" text;--> statement-breakpoint
ALTER TABLE "mock_cfn_character" ADD CONSTRAINT "mock_cfn_character_cfn_user_id_mock_cfn_player_cfn_user_id_fk" FOREIGN KEY ("cfn_user_id") REFERENCES "public"."mock_cfn_player"("cfn_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_character_rating" ADD CONSTRAINT "player_character_rating_player_id_sf6_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."sf6_player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_character_baseline" ADD CONSTRAINT "session_character_baseline_session_id_game_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mock_cfn_character_uq" ON "mock_cfn_character" USING btree ("cfn_user_id","character_key");--> statement-breakpoint
CREATE UNIQUE INDEX "player_character_rating_uq" ON "player_character_rating" USING btree ("player_id","character_key");--> statement-breakpoint
CREATE UNIQUE INDEX "session_character_baseline_uq" ON "session_character_baseline" USING btree ("session_id","character_key");--> statement-breakpoint
-- ── Backfill (hand-written, deterministic, no invented data) ────────────────────────────────
-- 1. Sessions created before per-character ratings: their single global initial/final rating
--    belongs to an unknown character, so they are marked legacy and get NO character baselines.
UPDATE "game_session" SET "rating_model" = 'legacy';--> statement-breakpoint
-- 2. Matches: character key derived from the stored display name with the same slug rule as
--    toCharacterKey() ("A.K.I." → "aki", "M. Bison" → "m-bison"); missing names → "unknown".
UPDATE "match" SET "player_character" = 'Unknown' WHERE "player_character" IS NULL;--> statement-breakpoint
UPDATE "match" SET "character_key" = lower(regexp_replace(regexp_replace(replace(trim("player_character"), '.', ''), '\s+', '-', 'g'), '[^a-zA-Z0-9-]', '', 'g'));--> statement-breakpoint
UPDATE "match" SET "character_key" = 'unknown' WHERE "character_key" IS NULL OR "character_key" = '';--> statement-breakpoint
--    v1 stored the rating after the match as two columns; MR present ⇒ MR system, else LP.
UPDATE "match" SET "rating_after_system" = 'mr', "rating_after_value" = "master_rate_after" WHERE "master_rate_after" IS NOT NULL;--> statement-breakpoint
UPDATE "match" SET "rating_after_system" = 'lp', "rating_after_value" = "league_points_after" WHERE "master_rate_after" IS NULL AND "league_points_after" IS NOT NULL;--> statement-breakpoint
-- 3. Mock CFN (dev data): same derivations; rosters are re-seeded lazily by the mock provider.
UPDATE "mock_cfn_match" SET "character_key" = lower(regexp_replace(regexp_replace(replace(trim("player_character"), '.', ''), '\s+', '-', 'g'), '[^a-zA-Z0-9-]', '', 'g'));--> statement-breakpoint
UPDATE "mock_cfn_match" SET "rating_after_system" = CASE WHEN "master_rate_after" IS NOT NULL THEN 'mr' ELSE 'lp' END, "rating_after_value" = COALESCE("master_rate_after", "league_points_after");
