import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from './schema.js'
import { env } from '../config/env.js'

const sql = neon(env.DATABASE_URL)
export const db = drizzle(sql, { schema })

export type DrizzleDb = typeof db
