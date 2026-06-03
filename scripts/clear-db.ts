/**
 * clear-db.ts — wipe all application data (development utility).
 *
 * TRUNCATEs every table defined in src/db/schema.ts with RESTART IDENTITY CASCADE,
 * so all rows are removed and foreign-key order is handled automatically. The
 * Drizzle migrations table is NOT in the schema object, so migration history is
 * preserved — only your data is cleared, not the schema.
 *
 * Usage:
 *   npm run db:clear -- --yes
 *
 * Safety:
 *   - Refuses to run when NODE_ENV=production.
 *   - Requires the explicit --yes flag, so it cannot wipe data by accident.
 */
import 'dotenv/config'
import { sql, getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import { db } from '../src/db/index.js'
import * as schema from '../src/db/schema.js'
import { env } from '../src/config/env.js'
import { logger } from '../src/utils/logger.js'

async function clearDb(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to clear the database while NODE_ENV=production')
  }

  if (!process.argv.includes('--yes')) {
    logger.warn('This DELETES ALL ROWS from every table. Re-run to confirm:  npm run db:clear -- --yes')
    return
  }

  // Collect every table object exported from the schema (ignores enums/helpers).
  const tableNames = Object.values(schema)
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => `"${getTableName(table)}"`)

  if (tableNames.length === 0) {
    logger.warn('No tables found in schema — nothing to clear')
    return
  }

  // One statement: CASCADE satisfies FK dependencies, RESTART IDENTITY resets counters.
  await db.execute(sql.raw(`TRUNCATE TABLE ${tableNames.join(', ')} RESTART IDENTITY CASCADE;`))
  logger.info({ count: tableNames.length }, `Cleared all rows from ${tableNames.length} tables`)
}

clearDb()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error({ err }, 'Failed to clear database')
    process.exit(1)
  })
