CREATE TABLE "creator_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_hash" "bytea" NOT NULL,
	"key_hint" text NOT NULL,
	"plan" text NOT NULL,
	"grant_days" integer NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"issued_by" text NOT NULL,
	"issued_note" text,
	"redeemed_by" text,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "creator_key_hash_len_ck" CHECK (octet_length("creator_key"."key_hash") = 32),
	CONSTRAINT "creator_key_hint_ck" CHECK ("creator_key"."key_hint" ~ '^[0-9A-HJKMNP-TV-Z]{4}$'),
	CONSTRAINT "creator_key_plan_ck" CHECK ("creator_key"."plan" in ('creator_beta')),
	CONSTRAINT "creator_key_grant_days_ck" CHECK ("creator_key"."grant_days" between 1 and 366),
	CONSTRAINT "creator_key_window_ck" CHECK ("creator_key"."expires_at" > "creator_key"."issued_at"),
	CONSTRAINT "creator_key_note_len_ck" CHECK ("creator_key"."issued_note" is null or length("creator_key"."issued_note") <= 200),
	CONSTRAINT "creator_key_redeemed_ck" CHECK ("creator_key"."redeemed_by" is null or "creator_key"."redeemed_at" is not null),
	CONSTRAINT "creator_key_revoked_ck" CHECK ("creator_key"."revoked_by" is null or "creator_key"."revoked_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD COLUMN "creator_key_id" uuid;--> statement-breakpoint
ALTER TABLE "creator_key" ADD CONSTRAINT "creator_key_redeemed_by_auth_user_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_key_hash_uq" ON "creator_key" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "creator_key_redeemed_by_idx" ON "creator_key" USING btree ("redeemed_by");--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_creator_key_id_creator_key_id_fk" FOREIGN KEY ("creator_key_id") REFERENCES "public"."creator_key"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grant_creator_key_uq" ON "entitlement_grant" USING btree ("creator_key_id") WHERE "entitlement_grant"."creator_key_id" is not null;--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_creator_key_source_ck" CHECK (("entitlement_grant"."source" = 'creator_key') = ("entitlement_grant"."creator_key_id" is not null));