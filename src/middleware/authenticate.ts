import type { FastifyReply, FastifyRequest } from 'fastify'

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify()
  } catch {
    reply.status(401).send({ ok: false, code: 'UNAUTHORIZED', message: 'Token invalid or expired' })
  }
}
