CREATE TABLE "account_plan" (
	"user_id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_plan_plan_ck" CHECK ("account_plan"."plan" in ('free', 'creator_beta'))
);
--> statement-breakpoint
CREATE TABLE "entitlement_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"plan" text NOT NULL,
	"source" text NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_grant_plan_ck" CHECK ("entitlement_grant"."plan" in ('creator_beta')),
	CONSTRAINT "entitlement_grant_source_ck" CHECK ("entitlement_grant"."source" in ('operator', 'creator_key')),
	CONSTRAINT "entitlement_grant_window_ck" CHECK ("entitlement_grant"."expires_at" is null or "entitlement_grant"."expires_at" > "entitlement_grant"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "account_plan" ADD CONSTRAINT "account_plan_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlement_grant_user_idx" ON "entitlement_grant" USING btree ("user_id");