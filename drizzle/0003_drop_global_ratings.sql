ALTER TABLE "match" ALTER COLUMN "character_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "match" ALTER COLUMN "player_character" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mock_cfn_match" ALTER COLUMN "character_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "match" DROP COLUMN "league_points_after";--> statement-breakpoint
ALTER TABLE "match" DROP COLUMN "master_rate_after";--> statement-breakpoint
ALTER TABLE "mock_cfn_match" DROP COLUMN "league_points_after";--> statement-breakpoint
ALTER TABLE "mock_cfn_match" DROP COLUMN "master_rate_after";--> statement-breakpoint
ALTER TABLE "mock_cfn_player" DROP COLUMN "main_character";--> statement-breakpoint
ALTER TABLE "mock_cfn_player" DROP COLUMN "league_points";--> statement-breakpoint
ALTER TABLE "mock_cfn_player" DROP COLUMN "master_rate";--> statement-breakpoint
ALTER TABLE "sf6_player" DROP COLUMN "main_character";--> statement-breakpoint
ALTER TABLE "sf6_player" DROP COLUMN "rank";--> statement-breakpoint
ALTER TABLE "sf6_player" DROP COLUMN "league_points";--> statement-breakpoint
ALTER TABLE "sf6_player" DROP COLUMN "master_rate";--> statement-breakpoint
ALTER TABLE "game_session" ADD CONSTRAINT "game_session_rating_model_ck" CHECK ("game_session"."rating_model" in ('per_character', 'legacy'));