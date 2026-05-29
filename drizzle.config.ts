import type { Config } from 'drizzle-kit'
import {dotENV} from "./src/config/dotEnv"


console.log(dotENV.DATABASE_URL);

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: dotENV.DIRECT_DATABASE_URL!
  }
} satisfies Config

