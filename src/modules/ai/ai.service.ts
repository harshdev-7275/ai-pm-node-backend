import { env } from '../../config/env.js'
import { AppError } from '../../utils/errors.js'
import type { ChatRequest, ChatIdentity, ChatResponse } from './ai.types.js'
import { logger } from '../../utils/logger.js'

/**
 * Proxy a chat request to ai-service over the trusted server-to-server channel.
 *
 * The caller's identity (userId/orgId/orgSlug) comes from the verified JWT and
 * is passed as trusted headers — ai-service never sees, nor trusts, the user's
 * JWT. Authentication to ai-service is the static AI_SERVICE_TOKEN.
 */
export const sendChatMessage = async (
  input: ChatRequest,
  identity: ChatIdentity,
): Promise<ChatResponse> => {
  if (!env.AI_SERVICE_TOKEN) {
    throw new AppError('AI_NOT_CONFIGURED', 'AI service is not configured', 503)
  }

  let res: Response
  try {
    res = await fetch(`${env.AI_SERVICE_URL}/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-Service-Token': env.AI_SERVICE_TOKEN,
        'X-User-Id':       identity.userId,
        'X-Org-Id':        identity.orgId,
        'X-Org-Slug':      identity.orgSlug,
      },
      body: JSON.stringify({
        message: input.message,
        ...(input.projectId ? { project_id: input.projectId } : {}),
        ...(input.history && input.history.length ? { history: input.history } : {}),
      }),
    })
  } catch {
    throw new AppError('AI_UNREACHABLE', 'AI service is unreachable', 502)
  }

  if (!res.ok) {
    throw new AppError('AI_REQUEST_FAILED', `AI service responded with ${res.status}`, 502)
  }

  return (await res.json()) as ChatResponse
}

/**
 * Fire-and-forget: trigger a full org graph sync on the ai-service.
 *
 * Called after project creation so the knowledge graph is populated
 * immediately. Failures are logged but never bubble up — the caller's
 * response must not be delayed or broken by ai-service availability.
 */
export const triggerGraphSync = (orgId: string, orgSlug: string): void => {
  if (!env.AI_SERVICE_TOKEN) return

  const url = `${env.AI_SERVICE_URL}/v1/graph/sync`
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'X-Service-Token': env.AI_SERVICE_TOKEN,
    },
    body: JSON.stringify({ org_id: orgId, org_slug: orgSlug }),
  }).catch((err: unknown) => {
    logger.warn({ err, url }, 'graph sync trigger failed (fire-and-forget)')
  })
}
