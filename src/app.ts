import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import { env } from '@/config/env.js'
import { handleError } from '@/middleware/errorHandler.js'

export async function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV === 'development'
      ? {
          level: env.LOG_LEVEL,
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : { level: env.LOG_LEVEL },
  })

  await app.register(helmet)
  await app.register(cors, { origin: env.CORS_ORIGIN })
  await app.register(jwt, { secret: env.JWT_SECRET })

  app.setErrorHandler((error, request, reply) => {
    handleError(error, {
      logError: (obj, msg) => { request.log.error(obj, msg) },
      send: (statusCode, body) => { void reply.status(statusCode).send(body) },
    })
  })

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  return app
}
