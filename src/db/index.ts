import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'
import { dotENV } from '../config/dotEnv.js'


const client = postgres(dotENV.DIRECT_DATABASE_URL!)
export const db = drizzle(client, { schema })
export type DB = typeof db