import { drizzle } from 'drizzle-orm/neon-serverless'
import { Pool } from '@neondatabase/serverless'
import * as schema from './schema.js'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

const pool = new Pool({
  connectionString:        env.DATABASE_URL,
  connectionTimeoutMillis: 30_000, // 30 s covers Neon cold-start wake-up (free tier pauses after 5 min)
  idleTimeoutMillis:       20_000,
  max:                     10,
})

pool.on('connect', () => {
  logger.info('DB connected')
})

pool.on('error', (err: Error) => {
  logger.error({ err }, 'DB pool error')
})

export const db = drizzle(pool, { schema })

export type DrizzleDb = typeof db
