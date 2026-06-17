import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import supertest from 'supertest'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import { authRoutes } from '../../auth/auth.routes.js'
import { orgsRoutes } from '../../orgs/orgs.routes.js'
import { aiRoutes } from '../ai.routes.js'
import { env } from '../../../config/env.js'

// =============================================================================
// TEST APP SETUP — mirrors the real app's auth decorator, no Swagger/Helmet
// =============================================================================

const buildTestApp = async () => {
  const app = Fastify()

  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: env.JWT_SECRET })
  await app.register(cookie, { secret: env.JWT_SECRET })

  app.decorate('authenticate', async (req: any, reply: any) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '')
      if (!token) return reply.status(401).send({ error: 'UNAUTHORIZED' })
      req.user = app.jwt.verify(token)
    } catch {
      return reply.status(401).send({ error: 'UNAUTHORIZED' })
    }
  })

  await app.register(authRoutes)
  await app.register(orgsRoutes, { prefix: '/orgs' })
  await app.register(aiRoutes)

  await app.ready()
  return app
}

const AI_RESPONSE = {
  message:    'Here is your answer.',
  tool_calls: [],
  model:      'test-model',
  steps:      1,
}

describe('AI proxy API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>
  let token:   string
  let orgId:   string
  let orgSlug: string

  const email = `ai_user_${Date.now()}@test.com`

  beforeAll(async () => {
    app = await buildTestApp()

    // Register a user, create an org, then re-login so the JWT carries
    // orgId/orgSlug (login resolves the user's first active org).
    const regRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'AI User', email, password: 'password123' })

    const orgRes = await supertest(app.server)
      .post('/orgs')
      .set('Authorization', `Bearer ${regRes.body.accessToken}`)
      .send({ name: 'AI Test Org' })
    orgId   = orgRes.body.id
    orgSlug = orgRes.body.slug

    const loginRes = await supertest(app.server)
      .post('/auth/login')
      .send({ email, password: 'password123' })
    token = loginRes.body.accessToken
  }, 30000)

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    // Ensure the service token is configured for the proxy path.
    env.AI_SERVICE_TOKEN = env.AI_SERVICE_TOKEN ?? 'x'.repeat(32)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects unauthenticated requests with 401', async () => {
    const res = await supertest(app.server)
      .post('/ai/chat')
      .send({ message: 'hello' })
    expect(res.status).toBe(401)
  })

  it('forwards the request to ai-service with the service token + identity headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(AI_RESPONSE), {
        status:  200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await supertest(app.server)
      .post('/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'who is most active?', projectId: '11111111-1111-4111-8111-111111111111' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual(AI_RESPONSE)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${env.AI_SERVICE_URL}/v1/chat`)

    const headers = init.headers as Record<string, string>
    expect(headers['X-Service-Token']).toBe(env.AI_SERVICE_TOKEN)
    expect(headers['X-Org-Id']).toBe(orgId)
    expect(headers['X-Org-Slug']).toBe(orgSlug)
    expect(headers['X-User-Id']).toBeTruthy()

    const body = JSON.parse(init.body as string)
    expect(body.message).toBe('who is most active?')
    expect(body.project_id).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('never forwards a client-supplied Authorization or service token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(AI_RESPONSE), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await supertest(app.server)
      .post('/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', 'attacker-org')
      .send({ message: 'hello' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    // identity is taken from the verified JWT, not from client headers
    expect(headers['X-Org-Id']).toBe(orgId)
  })

  it('returns 400 when the message is empty', async () => {
    const res = await supertest(app.server)
      .post('/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: '' })
    expect(res.status).toBe(400)
  })

  it('returns 502 when ai-service responds with an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('upstream boom', { status: 500 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await supertest(app.server)
      .post('/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'hello' })
    expect(res.status).toBe(502)
  })
})
