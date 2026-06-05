import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../config/env.js'

// =============================================================================
// INTERNAL AUTH — service-mesh secret check for server-to-server routes
// Mirrors botAuth, but guards the /admin/metering/* routes that the Python
// AI service calls with X-Internal-Secret. Never exposed to end users.
// =============================================================================

export async function internalAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const secret = request.headers['x-internal-secret']
  if (!secret || secret !== env.INTERNAL_SECRET) {
    reply.status(401).send({ ok: false, code: 'UNAUTHORIZED', message: 'Invalid internal secret' })
  }
}
