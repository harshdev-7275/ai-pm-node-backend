import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { chatRequestSchema } from './ai.schema.js'
import * as aiService from './ai.service.js'
import { AppError } from '../../utils/errors.js'

const chatRequestJsonSchema = {
  type: 'object' as const,
  properties: {
    message:   { type: 'string', minLength: 1, maxLength: 4000 },
    projectId: { type: 'string', format: 'uuid' },
    history: {
      type: 'array' as const,
      maxItems: 50,
      items: {
        type: 'object' as const,
        properties: {
          role:    { type: 'string', enum: ['user', 'assistant'] },
          content: { type: 'string', minLength: 1, maxLength: 8000 },
        },
        required: ['role', 'content'],
      },
    },
  },
  required: ['message'],
}

const toolCallSchema = {
  type: 'object' as const,
  properties: {
    tool:           { type: 'string' },
    args:           { type: 'object' },
    result_preview: { type: 'string', nullable: true },
  },
}

const chatResponseSchema = {
  type: 'object' as const,
  properties: {
    message:    { type: 'string' },
    tool_calls: { type: 'array', items: toolCallSchema },
    model:      { type: 'string' },
    steps:      { type: 'number' },
  },
}

const errorSchema = {
  type: 'object' as const,
  properties: {
    error:   { type: 'string' },
    message: { type: 'string' },
  },
}

export const aiRoutes = async (app: FastifyInstance) => {

  // POST /ai/chat — BFF proxy to ai-service (protected by user JWT)
  app.post('/ai/chat', {
    preHandler: [app.authenticate],
    validatorCompiler: () => () => true, // AJV skipped — Zod safeParse in handler owns validation
    schema: {
      summary: 'Chat with the AI assistant',
      description: 'Proxies a chat message to the AI service over a trusted server-to-server channel.',
      tags: ['AI'],
      security: [{ bearerAuth: [] }],
      body: chatRequestJsonSchema,
      response: {
        200: chatResponseSchema,
        400: errorSchema,
        401: errorSchema,
        502: errorSchema,
        503: errorSchema,
      },
    },
  }, async (req, reply) => {
    const parsed = chatRequestSchema.safeParse(req.body)

    if (!parsed.success) {
      return reply.status(400).send({
        error:  'VALIDATION_ERROR',
        issues: parsed.error.issues.map((e: z.core.$ZodIssue) => ({
          field:   e.path.join('.'),
          message: e.message,
        })),
      })
    }

    const { userId, orgId, orgSlug } = req.user

    if (!orgId || !orgSlug) {
      return reply.status(400).send({
        error:   'NO_ACTIVE_ORG',
        message: 'No active organization for this user',
      })
    }

    try {
      const result = await aiService.sendChatMessage(parsed.data, { userId, orgId, orgSlug })
      return reply.status(200).send(result)
    } catch (err: unknown) {
      if (err instanceof AppError && (
        err.code === 'AI_NOT_CONFIGURED' ||
        err.code === 'AI_UNREACHABLE' ||
        err.code === 'AI_REQUEST_FAILED'
      )) {
        return reply.status(err.statusCode as 502 | 503).send({
          error:   err.code,
          message: err.message,
        })
      }
      throw err
    }
  })
}
