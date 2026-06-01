import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../config/env.js'

export async function botAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const secret = request.headers['x-bot-secret']
  if (!secret || secret !== env.BOT_SECRET) {
    reply.status(401).send({ ok: false, code: 'UNAUTHORIZED', message: 'Invalid bot secret' })
  }
}
