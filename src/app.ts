import Fastify from 'fastify'
import type { FastifyRequest, FastifyReply } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'
import { env } from './config/env.js'
import { handleError } from './middleware/errorHandler.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { orgsRoutes } from './modules/orgs/orgs.routes.js'
import { projectsRoutes } from './modules/projects/projects.routes.js'

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
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim())
  await app.register(cors, { origin: allowedOrigins, credentials: true })
  await app.register(jwt, { secret: env.JWT_SECRET })
  await app.register(cookie, { secret: env.JWT_SECRET })

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'PM Backend API',
        description: 'Project Management Backend API Documentation',
        version: '1.0.0',
      },
      servers: [
        {
          url: env.NODE_ENV === 'development' ? `http://localhost:${env.PORT}` : env.API_URL,
          description: env.NODE_ENV === 'development' ? 'Development' : 'Production',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  })

  await app.register(swaggerUI, {
    routePrefix: '/documentation',
  })

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
  await app.register(orgsRoutes, { prefix: '/orgs' })
  await app.register(projectsRoutes, { prefix: '/orgs/:slug/projects' })

  app.get('/health', {
    schema: {
      summary: 'Health check',
      description: 'Returns the current health status of the API',
      tags: ['System'],
      response: {
        200: {
          type: 'object' as const,
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  return app
}
