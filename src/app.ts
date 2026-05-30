import Fastify from 'fastify'
import type { FastifyRequest, FastifyReply } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import { env } from './config/env.js'
import { handleError } from './middleware/errorHandler.js'
import { authRoutes } from './modules/auth/auth.routes.js'

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
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true })
  await app.register(jwt, { secret: env.JWT_SECRET })
  await app.register(cookie, { secret: env.JWT_SECRET })

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '')
      if (!token) {
        return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'No token provided' })
      }
      req.user = app.jwt.verify(token)
    } catch {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' })
    }
  })

  app.setErrorHandler((error, request, reply) => {
    handleError(error, {
      logError: (obj, msg) => { request.log.error(obj, msg) },
      send: (statusCode, body) => { void reply.status(statusCode).send(body) },
    })
  })

  await app.register(authRoutes)

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  return app
}
