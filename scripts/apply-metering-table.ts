/**
 * apply-metering-table.ts — create the org_usage table directly.
 *
 * Why this exists: drizzle-kit migrate didn't apply 0002 (Supabase's transaction
 * pooler on :6543 doesn't run migrations reliably — migrations want a session
 * connection on :5432). This runs the 0002 DDL through the SAME connection the
 * app uses (DATABASE_URL), so the table lands where the API can see it.
 * Idempotent — safe to run more than once.
 *
 *   npx tsx scripts/apply-metering-table.ts
 */
import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../src/db/index.js'

async function main(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "org_usage" (
      "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "org_slug"   varchar(100) NOT NULL,
      "tokens"     bigint  DEFAULT 0 NOT NULL,
      "requests"   integer DEFAULT 0 NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "org_usage_org_slug_unique" UNIQUE ("org_slug")
    )
  `)

  const res = await db.execute(sql`SELECT to_regclass('public.org_usage') AS tbl`)
  const rows = (res as { rows?: Array<{ tbl: string | null }> }).rows
    ?? (res as unknown as Array<{ tbl: string | null }>)
  console.log('✓ org_usage table:', rows?.[0]?.tbl ?? '(still missing — check DATABASE_URL)')
  process.exit(0)
}

void main()
