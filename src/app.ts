import Fastify from 'fastify'
import type { FastifyRequest, FastifyReply } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'
import { env } from './config/env.js'
import { handleError } from './middleware/errorHandler.js'
import { markServiceRequest } from './middleware/authenticateService.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { usersRoutes } from './modules/users/users.routes.js'
import { orgsRoutes } from './modules/orgs/orgs.routes.js'
import { projectsRoutes } from './modules/projects/projects.routes.js'
import { issuesRoutes } from './modules/issues/issues.routes.js'
import { commentsRoutes } from './modules/issues/comments.routes.js'
import { statusesRoutes } from './modules/issues/statuses.routes.js'
import { sprintsRoutes } from './modules/sprints/sprints.routes.js'
import { categoriesRoutes } from './modules/categories/categories.routes.js'
import { aiRoutes } from './modules/ai/ai.routes.js'
import { createGraphSyncHook } from './modules/ai/graphSync.hook.js'
import { triggerGraphSync, triggerProjectGraphSync } from './modules/ai/ai.service.js'
import { debounceByKey } from './utils/debounceByKey.js'

// Coalesce graph-sync bursts (e.g. dragging several cards) into one resync per
// project/org. Trailing-edge: fires ~this long after the last mutation settles.
const GRAPH_SYNC_DEBOUNCE_MS = 2500

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
  await app.register(cors, {
    origin:  allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
  await app.register(jwt, { secret: env.JWT_SECRET })
  await app.register(cookie, { secret: env.JWT_SECRET })

  // Must run before any preHandler so req.isServiceRequest is set when
  // requireOrgMember / requireProjectAccess inspect it.
  app.addHook('onRequest', markServiceRequest)

  // Keep the ai-service knowledge graph fresh: after any successful mutation of
  // project-scoped data, schedule a (debounced) graph sync. Fire-and-forget —
  // never blocks or fails the user's response. See graphSync.hook.ts.
  const debouncedProjectSync = debounceByKey(triggerProjectGraphSync, GRAPH_SYNC_DEBOUNCE_MS)
  const debouncedOrgSync     = debounceByKey(triggerGraphSync, GRAPH_SYNC_DEBOUNCE_MS)
  app.addHook('onResponse', createGraphSyncHook({
    syncProject: (orgId, orgSlug, projectId) => debouncedProjectSync(projectId, orgId, orgSlug, projectId),
    syncOrg:     (orgId, orgSlug)            => debouncedOrgSync(orgId, orgId, orgSlug),
  }))

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

  // Rate limiting scoped to auth routes only (10 req/min per IP on login and signup)
  // Note: authRoutes define routes with /auth/ prefix (e.g. POST /auth/login)
  // so this plugin is registered without an additional prefix
  await app.register(async (authApp) => {
    await authApp.register(rateLimit, {
      max: 10,
      timeWindow: '1 minute',
      keyGenerator: (req) => req.ip,
    })
    await authApp.register(authRoutes)
  })

  await app.register(usersRoutes)

  await app.register(orgsRoutes, { prefix: '/orgs' })
  await app.register(issuesRoutes,   { prefix: '/orgs/:slug/projects/:projectId/issues' })
  await app.register(commentsRoutes, { prefix: '/orgs/:slug/projects/:projectId/issues' })
  await app.register(statusesRoutes, { prefix: '/orgs/:slug/projects/:projectId/statuses' })
  await app.register(sprintsRoutes,    { prefix: '/orgs/:slug/projects/:projectId/sprints' })
  await app.register(categoriesRoutes, { prefix: '/orgs/:slug/projects/:projectId/categories' })
  await app.register(projectsRoutes,   { prefix: '/orgs/:slug/projects' })
  await app.register(aiRoutes)

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
