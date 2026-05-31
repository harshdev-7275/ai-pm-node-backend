import { drizzle } from 'drizzle-orm/neon-serverless'
import { Pool } from '@neondatabase/serverless'
import * as schema from './schema.js'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

const pool = new Pool({
  connectionString:        env.DATABASE_URL,
  connectionTimeoutMillis: 10_000, // wait up to 10 s for a connection (covers Neon cold-start wake-up)
  idleTimeoutMillis:       20_000, // release idle connections after 20 s
  max:                     10,
})

pool.on('connect', () => {
  logger.info('DB connected')
})

pool.on('error', (err) => {
  logger.error({ err }, 'DB pool error')
})

export const db = drizzle(pool, { schema })

export type DrizzleDb = typeof db
