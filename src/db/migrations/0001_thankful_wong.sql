CREATE TYPE "public"."cadence_type" AS ENUM('none', 'weekly', 'biweekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."status_category" AS ENUM('todo', 'in_progress', 'done');--> statement-breakpoint
ALTER TABLE "issue_statuses" ADD COLUMN "category" "status_category" DEFAULT 'todo' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cadence_type" "cadence_type" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cadence_start_day" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cadence_duration" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cadence_auto_create" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cadence_naming" varchar(100);