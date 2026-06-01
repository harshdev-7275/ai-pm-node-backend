import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'

vi.mock('../../config/env', () => ({
  env: { BOT_SECRET: 'test-bot-secret-16ch' },
}))

const { botAuth } = await import('../botAuth')

function makeRequest(headers: Record<string, string> = {}): FastifyRequest {
  return { headers } as unknown as FastifyRequest
}

function makeReply() {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  }
  return reply as unknown as FastifyReply
}

describe('botAuth middleware', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not send 401 when X-Bot-Secret matches', async () => {
    const req = makeRequest({ 'x-bot-secret': 'test-bot-secret-16ch' })
    const reply = makeReply()

    await botAuth(req, reply)

    expect(reply.status).not.toHaveBeenCalled()
  })

  it('returns 401 when header is missing', async () => {
    const req = makeRequest({})
    const reply = makeReply()

    await botAuth(req, reply)

    expect(reply.status).toHaveBeenCalledWith(401)
    expect(reply.send).toHaveBeenCalledWith({
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'Invalid bot secret',
    })
  })

  it('returns 401 when secret is wrong', async () => {
    const req = makeRequest({ 'x-bot-secret': 'wrong-secret' })
    const reply = makeReply()

    await botAuth(req, reply)

    expect(reply.status).toHaveBeenCalledWith(401)
  })
})
