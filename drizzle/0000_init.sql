CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"baseline_match_id" text,
	"baseline_played_at" timestamp with time zone,
	"initial_rank" text,
	"initial_league_points" integer,
	"initial_master_rate" integer,
	"final_rank" text,
	"final_league_points" integer,
	"final_master_rate" integer,
	"filter" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_session_status_ck" CHECK ("game_session"."status" in ('active', 'ended'))
);
--> statement-breakpoint
CREATE TABLE "match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"session_id" uuid,
	"external_match_id" text NOT NULL,
	"played_at" timestamp with time zone NOT NULL,
	"mode" text NOT NULL,
	"result" text NOT NULL,
	"player_character" text,
	"player_control_type" text,
	"opponent_name" text,
	"opponent_character" text,
	"opponent_rank" text,
	"league_points_after" integer,
	"master_rate_after" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_result_ck" CHECK ("match"."result" in ('win', 'loss', 'draw'))
);
--> statement-breakpoint
CREATE TABLE "mock_cfn_match" (
	"id" text PRIMARY KEY NOT NULL,
	"cfn_user_id" text NOT NULL,
	"played_at" timestamp with time zone NOT NULL,
	"mode" text NOT NULL,
	"result" text NOT NULL,
	"player_character" text NOT NULL,
	"opponent_name" text NOT NULL,
	"opponent_character" text NOT NULL,
	"league_points_after" integer NOT NULL,
	"master_rate_after" integer
);
--> statement-breakpoint
CREATE TABLE "mock_cfn_player" (
	"cfn_user_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"main_character" text NOT NULL,
	"league_points" integer NOT NULL,
	"master_rate" integer,
	"fail_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overlay" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"public_token" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overlay_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "overlay_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"overlay_id" uuid NOT NULL,
	"instance_id" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sf6_player" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"cfn_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"main_character" text,
	"rank" text,
	"league_points" integer,
	"master_rate" integer,
	"profile_updated_at" timestamp with time zone,
	"next_poll_at" timestamp with time zone,
	"profile_refresh_until" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_poll_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_session" ADD CONSTRAINT "game_session_player_id_sf6_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."sf6_player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_player_id_sf6_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."sf6_player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_session_id_game_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_cfn_match" ADD CONSTRAINT "mock_cfn_match_cfn_user_id_mock_cfn_player_cfn_user_id_fk" FOREIGN KEY ("cfn_user_id") REFERENCES "public"."mock_cfn_player"("cfn_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlay" ADD CONSTRAINT "overlay_player_id_sf6_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."sf6_player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlay_connection" ADD CONSTRAINT "overlay_connection_overlay_id_overlay_id_fk" FOREIGN KEY ("overlay_id") REFERENCES "public"."overlay"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sf6_player" ADD CONSTRAINT "sf6_player_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_account_user_id_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_id_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "game_session_one_active_uq" ON "game_session" USING btree ("player_id") WHERE "game_session"."status" = 'active';--> statement-breakpoint
CREATE INDEX "game_session_player_started_idx" ON "game_session" USING btree ("player_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "match_player_external_uq" ON "match" USING btree ("player_id","external_match_id");--> statement-breakpoint
CREATE INDEX "match_session_idx" ON "match" USING btree ("session_id","played_at");--> statement-breakpoint
CREATE INDEX "match_player_played_idx" ON "match" USING btree ("player_id","played_at");--> statement-breakpoint
CREATE INDEX "mock_cfn_match_user_played_idx" ON "mock_cfn_match" USING btree ("cfn_user_id","played_at");--> statement-breakpoint
CREATE INDEX "overlay_player_idx" ON "overlay" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "overlay_connection_overlay_idx" ON "overlay_connection" USING btree ("overlay_id","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sf6_player_user_id_uq" ON "sf6_player" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sf6_player_next_poll_idx" ON "sf6_player" USING btree ("next_poll_at");