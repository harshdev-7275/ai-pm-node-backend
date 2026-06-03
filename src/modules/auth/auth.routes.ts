import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { registerSchema, loginSchema } from './auth.schema.js'
import * as authService from './auth.service.js'
import { refreshCookieOptions, REFRESH_COOKIE_PATH } from './auth.cookies.js'
import { env } from '../../config/env.js'

const userResponseSchema = {
  type: 'object' as const,
  properties: {
    id:        { type: 'string' },
    name:      { type: 'string' },
    email:     { type: 'string' },
    avatarUrl: { type: 'string', nullable: true },
    jobTitle:  { type: 'string', nullable: true },
    timezone:  { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
}

const registerRequestSchema = {
  type: 'object' as const,
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 255 },
    email: { type: 'string', format: 'email', maxLength: 255 },
    password: { type: 'string', minLength: 8 },
    jobTitle: { type: 'string', enum: ['engineer', 'designer', 'product_manager', 'marketer', 'founder', 'other'], nullable: true },
  },
  required: ['name', 'email', 'password'],
}

const loginRequestSchema = {
  type: 'object' as const,
  properties: {
    email: { type: 'string', format: 'email', maxLength: 255 },
    password: { type: 'string', minLength: 1 },
  },
  required: ['email', 'password'],
}

const authResponseSchema = {
  type: 'object' as const,
  properties: {
    user:        userResponseSchema,
    accessToken: { type: 'string' },
    expiresIn:   { type: 'number' },
  },
}

const refreshResponseSchema = {
  type: 'object' as const,
  properties: {
    accessToken: { type: 'string' },
    expiresIn:   { type: 'number' },
  },
}

const errorSchema = {
  type: 'object' as const,
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
  },
}

export const authRoutes = async (app: FastifyInstance) => {

  // POST /auth/register
  app.post('/auth/register', {
    validatorCompiler: () => () => true, // AJV skipped — Zod safeParse in handler owns validation
    schema: {
      summary: 'Register a new user',
      description: 'Creates a new user account with email and password',
      tags: ['Auth'],
      body: registerRequestSchema,
      response: {
        201: authResponseSchema,
        400: errorSchema,
        409: errorSchema,
      },
    },
  }, async (req, reply) => {
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

      reply.setCookie('refresh_token', result.tokens.refreshToken, refreshCookieOptions(env.NODE_ENV))

      return reply.status(201).send({
        user:        result.user,
        accessToken: result.tokens.accessToken,
        expiresIn:   result.tokens.expiresIn,
      })
    } catch (err: unknown) {
      if (err instanceof Error && (err as any).code === 'EMAIL_TAKEN') {
        return reply.status(409).send({
          error:   'EMAIL_TAKEN',
          message: 'An account with this email already exists',
        })
      }
      throw err
    }
  })


  // POST /auth/login
  app.post('/auth/login', {
    validatorCompiler: () => () => true, // AJV skipped — Zod safeParse in handler owns validation
    schema: {
      summary: 'Login user',
      description: 'Authenticates user with email and password, returns access token',
      tags: ['Auth'],
      body: loginRequestSchema,
      response: {
        200: authResponseSchema,
        400: errorSchema,
        401: errorSchema,
      },
    },
  }, async (req, reply) => {
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

      reply.setCookie('refresh_token', result.tokens.refreshToken, refreshCookieOptions(env.NODE_ENV))

      return reply.status(200).send({
        user:        result.user,
        accessToken: result.tokens.accessToken,
        expiresIn:   result.tokens.expiresIn,
      })
    } catch (err: unknown) {
      if (err instanceof Error && (err as any).code === 'INVALID_CREDENTIALS') {
        return reply.status(401).send({
          error:   'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        })
      }
      throw err
    }
  })


  // POST /auth/refresh — browser sends cookie automatically
  app.post('/auth/refresh', {
    schema: {
      summary: 'Refresh access token',
      description: 'Generates a new access token using the refresh token from cookies',
      tags: ['Auth'],
      response: {
        200: refreshResponseSchema,
        401: errorSchema,
      },
    },
  }, async (req, reply) => {
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
      reply.clearCookie('refresh_token', { path: REFRESH_COOKIE_PATH })

      if (err instanceof Error && (
        (err as any).code === 'INVALID_REFRESH_TOKEN' ||
        (err as any).code === 'REFRESH_TOKEN_REVOKED' ||
        (err as any).code === 'REFRESH_TOKEN_EXPIRED'
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
    schema: {
      summary: 'Get current user',
      description: 'Returns the authenticated user profile',
      tags: ['Auth'],
      security: [{ bearerAuth: [] }],
      response: {
        200: userResponseSchema,
        401: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const user = await authService.getMe(req.user.userId)
      return reply.status(200).send(user)
    } catch (err: unknown) {
      if (err instanceof Error && (err as any).code === 'USER_NOT_FOUND') {
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
    schema: {
      summary: 'Logout user',
      description: 'Invalidates the current session and clears refresh token',
      tags: ['Auth'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object' as const,
          properties: {
            message: { type: 'string' },
          },
        },
        401: errorSchema,
      },
    },
  }, async (req, reply) => {
    await authService.logout(req.user.sessionId)

    reply.clearCookie('refresh_token', { path: REFRESH_COOKIE_PATH })

    return reply.status(200).send({ message: 'Logged out successfully' })
  })
}
