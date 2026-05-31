import { drizzle } from 'drizzle-orm/neon-serverless'
import { Pool } from '@neondatabase/serverless'
import * as schema from './schema.js'
import { env } from '../config/env.js'

const pool = new Pool({ connectionString: env.DATABASE_URL })
export const db = drizzle(pool, { schema })

export type DrizzleDb = typeof db
