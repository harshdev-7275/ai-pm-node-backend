import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_DATABASE_URL: z.string().min(1, 'DIRECT_DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'), // comma-separated for multiple origins
  API_URL: z.string().default('https://api.example.com'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Static shared secret for service-to-service auth (ai-service → node-backend).
  // If unset, service-token auth is disabled and all requests must carry a user JWT.
  AI_SERVICE_TOKEN: z.string().min(32).optional(),
  // Base URL of the (private) ai-service the BFF proxies chat requests to.
  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  // Cloudflare R2 (S3-compatible) object storage for user-uploaded avatars.
  // All four must be set for avatar uploads to work; if any is missing the
  // upload endpoints respond with STORAGE_NOT_CONFIGURED.
  R2_ACCOUNT_ID:        z.string().min(1).optional(),
  R2_ACCESS_KEY_ID:     z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET:            z.string().min(1).optional(),
})

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  /* eslint-disable no-console -- fail-fast path: the Pino logger depends on env, so it does not exist yet */
  console.error('Invalid environment variables:')
  parsed.error.issues.forEach((issue) => {
    console.error(`  ${issue.path.join('.')} — ${issue.message}`)
  })
  /* eslint-enable no-console */
  process.exit(1)
}

export const env = parsed.data
