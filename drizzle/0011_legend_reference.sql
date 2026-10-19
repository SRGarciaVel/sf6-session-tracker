ALTER TABLE "player_character_rating" ADD COLUMN "master_rating_ranking" integer;--> statement-breakpoint
ALTER TABLE "sf6_player" ADD COLUMN "legend_cutoff_mr" integer;--> statement-breakpoint
ALTER TABLE "sf6_player" ADD COLUMN "legend_cutoff_observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sf6_player" ADD COLUMN "legend_last_position" integer;--> statement-breakpoint
ALTER TABLE "sf6_player" ADD COLUMN "legend_first_non_legend_position" integer;--> statement-breakpoint
ALTER TABLE "sf6_player" ADD COLUMN "legend_first_non_legend_mr" integer;