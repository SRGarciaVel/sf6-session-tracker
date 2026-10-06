CREATE TABLE "creator_overlay_preset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_overlay_preset_name_ck" CHECK (length("creator_overlay_preset"."name") between 1 and 40),
	CONSTRAINT "creator_overlay_preset_config_ck" CHECK (jsonb_typeof("creator_overlay_preset"."config") = 'object' and octet_length("creator_overlay_preset"."config"::text) <= 8192)
);
--> statement-breakpoint
ALTER TABLE "creator_overlay_preset" ADD CONSTRAINT "creator_overlay_preset_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_overlay_preset_user_idx" ON "creator_overlay_preset" USING btree ("user_id","created_at");