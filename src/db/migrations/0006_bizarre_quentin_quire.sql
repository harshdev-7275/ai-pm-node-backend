CREATE TYPE "public"."kg_sync_kind" AS ENUM('incremental', 'full');--> statement-breakpoint
CREATE TYPE "public"."kg_sync_status" AS ENUM('pending', 'success', 'error');--> statement-breakpoint
CREATE TABLE "kg_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" "kg_sync_kind" NOT NULL,
	"status" "kg_sync_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" varchar(1000)
);
--> statement-breakpoint
ALTER TABLE "kg_sync_log" ADD CONSTRAINT "kg_sync_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_sync_log" ADD CONSTRAINT "kg_sync_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;