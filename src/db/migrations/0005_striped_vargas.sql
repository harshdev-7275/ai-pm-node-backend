-- parent_id self-referencing FK for the subtask hierarchy.
-- NOTE: this migration was generated against a stale snapshot (0004 was written
-- by hand without one), so everything already applied by 0004 has been pruned —
-- only the new FK remains. The 0005 snapshot re-syncs drizzle with the schema.

-- Null out orphaned parent references so the constraint can be created
UPDATE "issues" i SET "parent_id" = NULL
WHERE i."parent_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "issues" p WHERE p."id" = i."parent_id");
--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_parent_id_issues_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;
