import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { registerSchema, loginSchema } from './auth.schema.js'
import * as authService from './auth.service.js'

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   process.env['NODE_ENV'] === 'production',
  sameSite: 'lax' as const,
  maxAge:   30 * 24 * 60 * 60,
  path:     '/auth/refresh',
}

export const authRoutes = async (app: FastifyInstance) => {

  // POST /auth/register
  app.post('/auth/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body)

    if (!parsed.success) {
      return reply.status(400).send({
        error:  'VALIDATION_ERROR',
        issues: parsed.error.issues.map((e: z.core.$ZodIssue) => ({
          field:   e.path.join('.'),
          message: e.message,
        })),
      })
    }

    try {
      const result = await authService.register(parsed.data)

      reply.setCookie('refresh_token', result.tokens.refreshToken, REFRESH_COOKIE_OPTIONS)

      return reply.status(201).send({
        user:        result.user,
        accessToken: result.tokens.accessToken,
        expiresIn:   result.tokens.expiresIn,
      })
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'EMAIL_TAKEN') {
        return reply.status(409).send({
          error:   'EMAIL_TAKEN',
          message: 'An account with this email already exists',
        })
      }
      throw err
    }
  })


  // POST /auth/login
  app.post('/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)

    if (!parsed.success) {
      return reply.status(400).send({
        error:  'VALIDATION_ERROR',
        issues: parsed.error.issues.map((e: z.core.$ZodIssue) => ({
          field:   e.path.join('.'),
          message: e.message,
        })),
      })
    }

    try {
      const result = await authService.login(parsed.data)

      reply.setCookie('refresh_token', result.tokens.refreshToken, REFRESH_COOKIE_OPTIONS)

      return reply.status(200).send({
        user:        result.user,
        accessToken: result.tokens.accessToken,
        expiresIn:   result.tokens.expiresIn,
      })
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'INVALID_CREDENTIALS') {
        return reply.status(401).send({
          error:   'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        })
      }
      throw err
    }
  })


  // POST /auth/refresh — browser sends cookie automatically
  app.post('/auth/refresh', async (req, reply) => {
    const rawRefreshToken = req.cookies?.['refresh_token']

    if (!rawRefreshToken) {
      return reply.status(401).send({
        error:   'NO_REFRESH_TOKEN',
        message: 'No refresh token found',
      })
    }

    try {
      const result = await authService.refreshAccessToken(rawRefreshToken)

      return reply.status(200).send({
        accessToken: result.accessToken,
        expiresIn:   result.expiresIn,
      })
    } catch (err: unknown) {
      reply.clearCookie('refresh_token', { path: '/auth/refresh' })

      if (err instanceof Error && (
        err.message === 'INVALID_REFRESH_TOKEN' ||
        err.message === 'REFRESH_TOKEN_REVOKED' ||
        err.message === 'REFRESH_TOKEN_EXPIRED'
      )) {
        return reply.status(401).send({
          error:   err.message,
          message: 'Session expired — please login again',
        })
      }
      throw err
    }
  })


  // GET /auth/me  (protected)
  app.get('/auth/me', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    try {
      const user = await authService.getMe(req.user.userId)
      return reply.status(200).send(user)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'USER_NOT_FOUND') {
        return reply.status(404).send({
          error:   'USER_NOT_FOUND',
          message: 'User not found',
        })
      }
      throw err
    }
  })


  // POST /auth/logout  (protected)
  app.post('/auth/logout', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    await authService.logout(req.user.sessionId)

    reply.clearCookie('refresh_token', { path: '/auth/refresh' })

    return reply.status(200).send({ message: 'Logged out successfully' })
  })
}
