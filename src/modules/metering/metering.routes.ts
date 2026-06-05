import type { FastifyInstance } from 'fastify'
import { internalAuth } from '../../middleware/internalAuth.js'
import { addTokensSchema } from './metering.schema.js'
import * as meteringService from './metering.service.js'

// =============================================================================
// METERING ROUTES — internal, protected by X-Internal-Secret
// Registered under /admin/metering in app.ts
// The Python AI service's PostgresUsageStore is the only caller. Paths and
// response shapes here are the contract that store relies on — do not rename
// without updating ai-service/metering/usage.py.
// =============================================================================

const tokensResponseSchema = {
  type: 'object' as const,
  properties: { tokens: { type: 'number' } },
}

const requestsResponseSchema = {
  type: 'object' as const,
  properties: { requests: { type: 'number' } },
}

const errorSchema = {
  type: 'object' as const,
  properties: {
    ok:      { type: 'boolean' },
    code:    { type: 'string' },
    message: { type: 'string' },
    errors:  { type: 'object' },
  },
}

export const meteringRoutes = async (app: FastifyInstance): Promise<void> => {

  // POST /admin/metering/:org/add — add token delta, returns new cumulative total
  app.post('/:org/add', {
    preHandler: [internalAuth],
    schema: {
      summary:  'Metering — add tokens',
      tags:     ['Metering'],
      security: [{ internalSecret: [] }],
      response: { 200: tokensResponseSchema, 400: errorSchema, 401: errorSchema },
    },
  }, async (req, reply) => {
    const { org } = req.params as { org: string }
    const { tokens } = addTokensSchema.parse(req.body)
    const total = await meteringService.addTokens(org, tokens)
    return reply.status(200).send({ tokens: total })
  })

  // GET /admin/metering/:org/get — read cumulative token total
  app.get('/:org/get', {
    preHandler: [internalAuth],
    schema: {
      summary:  'Metering — get tokens',
      tags:     ['Metering'],
      security: [{ internalSecret: [] }],
      response: { 200: tokensResponseSchema, 401: errorSchema },
    },
  }, async (req, reply) => {
    const { org } = req.params as { org: string }
    const tokens = await meteringService.getTokens(org)
    return reply.status(200).send({ tokens })
  })

  // POST /admin/metering/:org/inc-request — bump request count, returns new total
  app.post('/:org/inc-request', {
    preHandler: [internalAuth],
    schema: {
      summary:  'Metering — increment request count',
      tags:     ['Metering'],
      security: [{ internalSecret: [] }],
      response: { 200: requestsResponseSchema, 401: errorSchema },
    },
  }, async (req, reply) => {
    const { org } = req.params as { org: string }
    const requests = await meteringService.incRequest(org)
    return reply.status(200).send({ requests })
  })

  // GET /admin/metering/:org/get-requests — read cumulative request count
  app.get('/:org/get-requests', {
    preHandler: [internalAuth],
    schema: {
      summary:  'Metering — get request count',
      tags:     ['Metering'],
      security: [{ internalSecret: [] }],
      response: { 200: requestsResponseSchema, 401: errorSchema },
    },
  }, async (req, reply) => {
    const { org } = req.params as { org: string }
    const requests = await meteringService.getRequests(org)
    return reply.status(200).send({ requests })
  })
}
