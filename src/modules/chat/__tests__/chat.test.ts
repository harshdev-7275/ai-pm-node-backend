import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import supertest from 'supertest'
import Fastify from 'fastify'
import jwtPlugin from '@fastify/jwt'
import { chatRoutes } from '../chat.routes.js'
import { env } from '../../../config/env.js'

// =============================================================================
// TEST APP SETUP
// =============================================================================

const TEST_PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000'

const buildTestApp = async () => {
  const app = Fastify()
  await app.register(jwtPlugin, { secret: env.JWT_SECRET })
  await app.register(chatRoutes)
  await app.ready()
  return app
}

// =============================================================================
// TESTS
// =============================================================================

describe('POST /api/chat', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const makeToken = (userId = 'user-abc-123') => app.jwt.sign({ userId })

  const validBody = {
    message:   'What are the open issues?',
    orgSlug:   'acme',
    projectId: TEST_PROJECT_ID,
  }

  // -------------------------------------------------------------------------
  describe('auth', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await supertest(app.server).post('/').send(validBody)
      expect(res.status).toBe(401)
    })

    it('returns 401 when JWT token is invalid', async () => {
      const res = await supertest(app.server)
        .post('/')
        .set('Authorization', 'Bearer not-a-real-token')
        .send(validBody)
      expect(res.status).toBe(401)
    })
  })

  // -------------------------------------------------------------------------
  describe('validation', () => {
    it('returns 400 when message is missing', async () => {
      const res = await supertest(app.server)
        .post('/')
        .set('Authorization', `Bearer ${makeToken()}`)
        .send({ orgSlug: 'acme', projectId: TEST_PROJECT_ID })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when orgSlug is missing', async () => {
      const res = await supertest(app.server)
        .post('/')
        .set('Authorization', `Bearer ${makeToken()}`)
        .send({ message: 'hello', projectId: TEST_PROJECT_ID })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
    })
  })

  // -------------------------------------------------------------------------
  describe('proxy behaviour', () => {
    it('injects userId from JWT and X-Internal-Secret into the AI service request', async () => {
      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        status: 200,
        json: async () => ({ reply: 'ok' }),
      } as Response)

      await supertest(app.server)
        .post('/')
        .set('Authorization', `Bearer ${makeToken('user-xyz')}`)
        .send(validBody)

      expect(fetchMock).toHaveBeenCalledOnce()
      const [, options] = fetchMock.mock.calls[0]!
      const body    = JSON.parse(options!.body as string)
      const headers = options!.headers as Record<string, string>

      // userId must come from the verified JWT — never from client-supplied body
      expect(body.user_id).toBe('user-xyz')
      expect(body.message).toBe(validBody.message)
      expect(body.org_slug).toBe(validBody.orgSlug)
      expect(headers['X-Internal-Secret']).toBe(env.INTERNAL_SECRET)
    })

    it('passes AI service status and body through to the client', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        status: 200,
        json: async () => ({ reply: 'Here is the answer' }),
      } as Response)

      const res = await supertest(app.server)
        .post('/')
        .set('Authorization', `Bearer ${makeToken()}`)
        .send(validBody)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ reply: 'Here is the answer' })
    })

    it('returns 5xx when AI service is unreachable', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('fetch failed: ECONNREFUSED'))

      const res = await supertest(app.server)
        .post('/')
        .set('Authorization', `Bearer ${makeToken()}`)
        .send(validBody)

      expect(res.status).toBeGreaterThanOrEqual(500)
    })
  })
})
