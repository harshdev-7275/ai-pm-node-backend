/**
 * check-metering.ts — diagnose the /admin/metering INTERNAL_ERROR.
 * Prints whether the org_usage table exists and runs each metering op, dumping
 * the real Postgres error if any.
 *
 *   npx tsx scripts/check-metering.ts
 */
import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../src/db/index.js'
import { addTokens, getTokens, incRequest, getRequests } from '../src/modules/metering/metering.service.js'

async function main(): Promise<void> {
  const org = 'diag-org'

  // 1. Does the table exist in the DB the APP connects to (DATABASE_URL)?
  try {
    const res = await db.execute(sql`SELECT to_regclass('public.org_usage') AS tbl`)
    const rows = (res as { rows?: Array<{ tbl: string | null }> }).rows ?? (res as unknown as Array<{ tbl: string | null }>)
    console.log('org_usage table:', rows?.[0]?.tbl ?? '(NULL — table does not exist in this DB)')
  } catch (err) {
    console.error('table check failed:', err)
  }

  // 2. Run each metering op and surface the real error.
  for (const [name, fn] of [
    ['getTokens',   () => getTokens(org)],
    ['addTokens 5', () => addTokens(org, 5)],
    ['incRequest',  () => incRequest(org)],
    ['getRequests', () => getRequests(org)],
  ] as const) {
    try {
      console.log(`✅ ${name} ->`, await fn())
    } catch (err) {
      console.error(`❌ ${name} failed:`)
      console.error(err)
      break
    }
  }

  process.exit(0)
}

void main()
