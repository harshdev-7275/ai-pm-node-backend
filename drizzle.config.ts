import type { Config } from 'drizzle-kit'
import './src/config/dotEnv'
import { env } from './src/config/env'

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DIRECT_DATABASE_URL
  }
} satisfies Config

