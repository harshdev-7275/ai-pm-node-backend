-- Migration: Add categories table, simplify sprint cadence, update issue types
--> statement-breakpoint

-- 1. Drop cadence columns from projects
ALTER TABLE "projects" DROP COLUMN IF EXISTS "cadence_type";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "cadence_start_day";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "cadence_duration";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "cadence_auto_create";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "cadence_naming";--> statement-breakpoint

-- 2. Add weekly_auto_create to projects
ALTER TABLE "projects" ADD COLUMN "weekly_auto_create" boolean NOT NULL DEFAULT false;--> statement-breakpoint

-- 3. Drop cadence_type enum
DROP TYPE IF EXISTS "public"."cadence_type";--> statement-breakpoint

-- 4. Migrate existing issue types: epic → feature, story → task
UPDATE "issues" SET "type" = 'feature' WHERE "type" = 'epic';--> statement-breakpoint
UPDATE "issues" SET "type" = 'task' WHERE "type" = 'story';--> statement-breakpoint

-- 5. Recreate issue_type enum without epic/story
CREATE TYPE "public"."issue_type_new" AS ENUM('feature', 'bug', 'task', 'subtask');--> statement-breakpoint
ALTER TABLE "issues" ALTER COLUMN "type" TYPE "public"."issue_type_new" USING "type"::text::"public"."issue_type_new";--> statement-breakpoint
DROP TYPE "public"."issue_type";--> statement-breakpoint
ALTER TYPE "public"."issue_type_new" RENAME TO "issue_type";--> statement-breakpoint

-- 6. Create categories table
CREATE TABLE "categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "name" varchar(100) NOT NULL,
  "color" varchar(7) NOT NULL DEFAULT '#6366f1',
  "description" varchar(500),
  "sprint_id" uuid,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- 7. Seed a "General" category for every existing project
INSERT INTO "categories" ("project_id", "org_id", "name", "color", "created_by")
SELECT p."id", p."org_id", 'General', '#6366f1', p."created_by"
FROM "projects" p
WHERE p."deleted_at" IS NULL;--> statement-breakpoint

-- 8. Add category_id to issues (nullable first for backfill)
ALTER TABLE "issues" ADD COLUMN "category_id" uuid REFERENCES "categories"("id");--> statement-breakpoint

-- 9. Assign all existing issues to the "General" category of their project
UPDATE "issues" i
SET "category_id" = c."id"
FROM "categories" c
WHERE c."project_id" = i."project_id"
  AND c."name" = 'General';--> statement-breakpoint

-- 10. Make category_id NOT NULL now that all rows are backfilled
ALTER TABLE "issues" ALTER COLUMN "category_id" SET NOT NULL;
