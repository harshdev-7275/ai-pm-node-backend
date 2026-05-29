import pino from 'pino'
import { env } from '@/config/env.js'

export const logger = env.NODE_ENV === 'development'
  ? pino({
      level: env.LOG_LEVEL,
      transport: { target: 'pino-pretty', options: { colorize: true } },
      base: { service: 'node-backend', env: env.NODE_ENV },
    })
  : pino({
      level: env.LOG_LEVEL,
      base: { service: 'node-backend', env: env.NODE_ENV },
    })
