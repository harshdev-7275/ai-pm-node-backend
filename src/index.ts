import './config/dotEnv.js'
import { buildApp } from './app.js'
import { env } from './config/env.js'
import { db } from './db/index.js'
import { logger } from './utils/logger.js'
import { sql } from 'drizzle-orm'

async function checkDb(): Promise<void> {
  try {
    await db.execute(sql`select 1`)
    logger.info('DB connection verified')
  } catch (err) {
    logger.error({ err }, 'DB connection failed — check DATABASE_URL or Neon project status')
    process.exit(1)
  }
}

async function start(): Promise<void> {
  await checkDb()
  const app = await buildApp()
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
