import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../config/env.js'

/**
 * onRequest hook — sets req.isServiceRequest = true when the caller presents
 * the static AI_SERVICE_TOKEN bearer token.
 *
 * This hook never rejects. If the token doesn't match (or AI_SERVICE_TOKEN is
 * unset), it simply leaves req.isServiceRequest = false and lets the existing
 * JWT middleware handle auth downstream.
 */
export async function markServiceRequest(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  req.isServiceRequest = false
  if (!env.AI_SERVICE_TOKEN) return

  const bearer = req.headers.authorization
  if (!bearer?.startsWith('Bearer ')) return

  const token = bearer.slice(7)
  if (token === env.AI_SERVICE_TOKEN) {
    req.isServiceRequest = true
    // Provide a synthetic user so route handlers that read req.user.userId
    // don't crash. Service requests bypass per-user DB filters.
    req.user = { userId: 'ai-service', email: 'ai-service@internal' }
  }
}
