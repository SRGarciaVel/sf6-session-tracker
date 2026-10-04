-- SEC-001: companion snapshots are strictly per account (was: one global row per CFN).
ALTER TABLE "companion_snapshot" DROP CONSTRAINT "companion_snapshot_pkey";--> statement-breakpoint
ALTER TABLE "companion_snapshot" ADD CONSTRAINT "companion_snapshot_user_id_cfn_user_id_pk" PRIMARY KEY("user_id","cfn_user_id");
