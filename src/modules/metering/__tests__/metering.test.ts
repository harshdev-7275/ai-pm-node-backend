import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import supertest from 'supertest'
import Fastify from 'fastify'
import { env } from '../../../config/env.js'
import { handleError } from '../../../middleware/errorHandler.js'

// The service hits Postgres — mock it so these tests exercise routing, auth,
// validation and response shaping without a database.
vi.mock('../metering.service.js', () => ({
  addTokens:   vi.fn(),
  getTokens:   vi.fn(),
  incRequest:  vi.fn(),
  getRequests: vi.fn(),
}))

import * as meteringService from '../metering.service.js'
import { meteringRoutes } from '../metering.routes.js'

// =============================================================================
// TEST APP — mirrors app.ts error handler so ZodError maps to 400
// =============================================================================

const buildTestApp = async () => {
  const app = Fastify()
  app.setErrorHandler((error, request, reply) => {
    handleError(error, {
      logError: (obj, msg) => { request.log.error(obj, msg) },
      send:     (statusCode, body) => { void reply.status(statusCode).send(body) },
    })
  })
  await app.register(meteringRoutes, { prefix: '/admin/metering' })
  await app.ready()
  return app
}

const auth = (req: supertest.Test) => req.set('X-Internal-Secret', env.INTERNAL_SECRET)

describe('metering routes', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  beforeAll(async () => { app = await buildTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(() => { vi.clearAllMocks() })

  // ---------------------------------------------------------------------------
  describe('auth', () => {
    it('rejects requests with no X-Internal-Secret', async () => {
      const res = await supertest(app.server).get('/admin/metering/acme/get')
      expect(res.status).toBe(401)
      expect(res.body.code).toBe('UNAUTHORIZED')
      expect(meteringService.getTokens).not.toHaveBeenCalled()
    })

    it('rejects requests with a wrong secret', async () => {
      const res = await supertest(app.server)
        .get('/admin/metering/acme/get')
        .set('X-Internal-Secret', 'nope')
      expect(res.status).toBe(401)
      expect(meteringService.getTokens).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  describe('POST /:org/add', () => {
    it('adds tokens and returns the new total', async () => {
      vi.mocked(meteringService.addTokens).mockResolvedValueOnce(150)

      const res = await auth(supertest(app.server).post('/admin/metering/acme/add'))
        .send({ tokens: 50 })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ tokens: 150 })
      expect(meteringService.addTokens).toHaveBeenCalledWith('acme', 50)
    })

    it('rejects a negative token delta with 400', async () => {
      const res = await auth(supertest(app.server).post('/admin/metering/acme/add'))
        .send({ tokens: -5 })

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('VALIDATION_ERROR')
      expect(meteringService.addTokens).not.toHaveBeenCalled()
    })

    it('rejects a non-numeric token value with 400', async () => {
      const res = await auth(supertest(app.server).post('/admin/metering/acme/add'))
        .send({ tokens: 'lots' })

      expect(res.status).toBe(400)
      expect(meteringService.addTokens).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  describe('GET /:org/get', () => {
    it('returns the cumulative token total', async () => {
      vi.mocked(meteringService.getTokens).mockResolvedValueOnce(900)

      const res = await auth(supertest(app.server).get('/admin/metering/acme/get'))

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ tokens: 900 })
      expect(meteringService.getTokens).toHaveBeenCalledWith('acme')
    })
  })

  // ---------------------------------------------------------------------------
  describe('POST /:org/inc-request', () => {
    it('increments and returns the new request count', async () => {
      vi.mocked(meteringService.incRequest).mockResolvedValueOnce(4)

      const res = await auth(supertest(app.server).post('/admin/metering/acme/inc-request'))

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ requests: 4 })
      expect(meteringService.incRequest).toHaveBeenCalledWith('acme')
    })
  })

  // ---------------------------------------------------------------------------
  describe('GET /:org/get-requests', () => {
    it('returns the cumulative request count', async () => {
      vi.mocked(meteringService.getRequests).mockResolvedValueOnce(12)

      const res = await auth(supertest(app.server).get('/admin/metering/acme/get-requests'))

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ requests: 12 })
      expect(meteringService.getRequests).toHaveBeenCalledWith('acme')
    })
  })
})
