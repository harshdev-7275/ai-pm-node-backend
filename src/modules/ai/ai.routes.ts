import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { chatRequestSchema } from './ai.schema.js'
import * as aiService from './ai.service.js'
import { AppError } from '../../utils/errors.js'
import { env } from '../../config/env.js'

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

// =============================================================================
// Shared helpers
// =============================================================================

/**
 * Validate the chat request body and pull the verified caller identity off
 * the JWT. Returns either a `{ ok: true, ... }` ready-to-use value or
 * `{ ok: false, reply }` that the caller should `return` to short-circuit the
 * handler with the appropriate status.
 */
type ValidatedChat =
  | { ok: true;  data: import('./ai.types.js').ChatRequest; identity: { userId: string; orgId: string; orgSlug: string } }
  | { ok: false; status: 400 | 401; body: { error: string; message?: string; issues?: unknown[] } }

function validateChatRequest(req: { body: unknown; user?: { userId?: string; orgId?: string; orgSlug?: string } }): ValidatedChat {
  const parsed = chatRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: {
        error:  'VALIDATION_ERROR',
        issues: parsed.error.issues.map((e: z.core.$ZodIssue) => ({
          field:   e.path.join('.'),
          message: e.message,
        })),
      },
    }
  }
  const { userId, orgId, orgSlug } = req.user ?? {}
  if (!userId || !orgId || !orgSlug) {
    return {
      ok: false,
      status: 401,
      body: { error: 'NO_ACTIVE_ORG', message: 'No active organization for this user' },
    }
  }
  return { ok: true, data: parsed.data, identity: { userId, orgId, orgSlug } }
}

/**
 * Compute the CORS origin to echo back when writing SSE headers directly to
 * reply.raw (which bypasses @fastify/cors). Same logic as the board SSE route.
 */
function sseCorsOrigin(requestOrigin: string | undefined): string {
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) return requestOrigin
  return allowedOrigins[0] ?? '*'
}

// =============================================================================
// Routes
// =============================================================================

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
    const v = validateChatRequest(req)
    if (!v.ok) {
      const r = reply.status(v.status)
      return v.status === 400
        ? r.send({ error: v.body.error, ...(v.body.issues ? { issues: v.body.issues } : {}) })
        : r.send({ error: v.body.error, message: v.body.message })
    }

    try {
      const result = await aiService.sendChatMessage(v.data, v.identity)
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

  // POST /ai/chat/stream — BFF SSE proxy to ai-service (protected by user JWT).
  // Same auth + body validation as /ai/chat, but the response body is a
  // streamed Server-Sent-Events connection. Cancellation propagates: when the
  // client disconnects, req.raw emits 'close' and we abort the upstream fetch
  // so the LangGraph run inside ai-service short-circuits.
  app.post('/ai/chat/stream', {
    preHandler: [app.authenticate],
    validatorCompiler: () => () => true, // AJV skipped — Zod safeParse in handler owns validation
    schema: {
      summary: 'Stream chat with the AI assistant (SSE)',
      description: 'Proxies a chat message to the AI service and streams the response as Server-Sent Events. Disconnect to cancel.',
      tags: ['AI'],
      security: [{ bearerAuth: [] }],
      body: chatRequestJsonSchema,
      response: {
        400: errorSchema,
        401: errorSchema,
      },
    },
  }, async (req, reply) => {
    const v = validateChatRequest(req)
    if (!v.ok) {
      const r = reply.status(v.status)
      return v.status === 400
        ? r.send({ error: v.body.error, ...(v.body.issues ? { issues: v.body.issues } : {}) })
        : r.send({ error: v.body.error, message: v.body.message })
    }

    const requestOrigin = req.headers.origin
    const ac = new AbortController()
    req.raw.on('close', () => {
      if (!reply.raw.writableEnded) ac.abort()
    })

    reply.raw.setHeader('Access-Control-Allow-Origin',      sseCorsOrigin(requestOrigin))
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true')
    reply.raw.setHeader('Content-Type',      'text/event-stream')
    reply.raw.setHeader('Cache-Control',     'no-cache')
    reply.raw.setHeader('Connection',        'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.raw.flushHeaders()

    let upstream: Response
    try {
      upstream = await aiService.streamChatMessage(v.data, v.identity, ac.signal)
    } catch (err: unknown) {
      // Client disconnected before the upstream handshake completed.
      if (err instanceof Error && err.name === 'AbortError') return
      // Map service errors to a single SSE error frame so the client always
      // sees a coherent stream (no half-open HTTP error in the middle of SSE).
      const payload = err instanceof AppError
        ? { type: 'error', code: err.code, message: err.message }
        : { type: 'error', code: 'INTERNAL_ERROR', message: 'AI proxy failed' }
      try {
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
      } catch { /* socket gone */ }
      reply.raw.end()
      return
    }

    if (!upstream.body) {
      reply.raw.end()
      return
    }

    const reader = upstream.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (reply.raw.writableEnded) break
        reply.raw.write(Buffer.from(value))
      }
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        req.log.error({ err }, 'chat stream pipe error')
      }
    } finally {
      try { reader.releaseLock() } catch { /* already released */ }
      reply.raw.end()
    }
  })
}

/**
 * Standalone route registration so the stream endpoint can be exercised in
 * tests without wiring the full app (auth, swagger, rate limiting, etc.).
 * Mirrors `aiRoutes` minus the preHandler — the test app supplies its own.
 */
export const streamChatRoutes = async (app: FastifyInstance) => {
  await aiRoutes(app)
}
