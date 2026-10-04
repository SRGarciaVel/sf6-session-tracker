CREATE TABLE "companion_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "companion_pairing_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companion_snapshot" (
	"cfn_user_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_id" uuid,
	"profile" jsonb,
	"profile_observed_at" timestamp with time zone,
	"matches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matches_observed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companion_device" ADD CONSTRAINT "companion_device_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_pairing_code" ADD CONSTRAINT "companion_pairing_code_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_snapshot" ADD CONSTRAINT "companion_snapshot_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_snapshot" ADD CONSTRAINT "companion_snapshot_device_id_companion_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."companion_device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companion_device_token_hash_uq" ON "companion_device" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "companion_device_user_idx" ON "companion_device" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companion_pairing_code_hash_uq" ON "companion_pairing_code" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "companion_pairing_code_user_idx" ON "companion_pairing_code" USING btree ("user_id");