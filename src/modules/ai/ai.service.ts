import { env } from '../../config/env.js'
import { AppError } from '../../utils/errors.js'
import type { ChatRequest, ChatIdentity, ChatResponse } from './ai.types.js'
import { logger } from '../../utils/logger.js'
import { recordSyncStart, recordSyncFinish, type SyncStartInput } from './kgSyncLog.service.js'

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
 * Fire-and-forget: trigger a FULL org graph sync on the ai-service.
 *
 * Called after project creation and after structural changes the incremental
 * sync skips (sprint lifecycle, member changes, statuses, categories) so the
 * knowledge graph reflects them. Failures are logged but never bubble up — the
 * caller's response must not be delayed or broken by ai-service availability.
 *
 * Returns the in-flight promise so callers/tests *may* await completion; the
 * request path never does (fire-and-forget — prefix the call with `void`).
 */
export const triggerGraphSync = (orgId: string, orgSlug: string): Promise<void> =>
  runSync({
    url:  `${env.AI_SERVICE_URL}/v1/graph/sync`,
    body: { org_id: orgId, org_slug: orgSlug },
    log:  { orgId, projectId: null, kind: 'full' },
  })

/**
 * Fire-and-forget: trigger an INCREMENTAL single-project sync on the ai-service.
 *
 * Re-syncs one project's issues (+ comments + history) — the high-frequency
 * path fired after issue/comment mutations. Same fire-and-forget contract as
 * {@link triggerGraphSync}.
 */
export const triggerProjectGraphSync = (
  orgId:     string,
  orgSlug:   string,
  projectId: string,
): Promise<void> =>
  runSync({
    url:  `${env.AI_SERVICE_URL}/v1/graph/sync/project/${projectId}`,
    body: { org_id: orgId, org_slug: orgSlug, project_id: projectId },
    log:  { orgId, projectId, kind: 'incremental' },
  })

/**
 * Shared engine for both sync triggers: record a pending kg_sync_log row, POST
 * to ai-service over the trusted server-to-server channel, then mark the row
 * success/error. All failures are swallowed-and-logged — never thrown.
 *
 * No-op (and no log row) when AI_SERVICE_TOKEN is unset (ai disabled).
 */
async function runSync(opts: {
  url:  string
  body: Record<string, unknown>
  log:  SyncStartInput
}): Promise<void> {
  const token = env.AI_SERVICE_TOKEN
  if (!token) return

  const id = await recordSyncStart(opts.log)

  try {
    const res = await fetch(opts.url, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-Service-Token': token,
      },
      body: JSON.stringify(opts.body),
    })

    if (!res.ok) {
      logger.warn({ url: opts.url, status: res.status }, 'graph sync failed (fire-and-forget)')
      await recordSyncFinish(id, { status: 'error', error: `ai-service responded ${res.status}` })
      return
    }

    await recordSyncFinish(id, { status: 'success' })
  } catch (err: unknown) {
    logger.warn({ err, url: opts.url }, 'graph sync trigger failed (fire-and-forget)')
    await recordSyncFinish(id, { status: 'error', error: 'ai-service unreachable' })
  }
}

/**
 * Open a streaming chat request to ai-service and return the raw upstream
 * Response so the caller can pipe its body straight to the client. The caller's
 * AbortSignal is threaded through to `fetch` so a client disconnect cancels
 * the upstream request (and the LangGraph run inside ai-service).
 *
 * The caller is responsible for streaming the response body — this function
 * only handles the handshake. Non-2xx responses throw; transport errors throw
 * `AI_UNREACHABLE`. AbortError is propagated so the caller can distinguish a
 * client-side cancel from an upstream failure.
 */
export const streamChatMessage = async (
  input: ChatRequest,
  identity: ChatIdentity,
  signal: AbortSignal,
): Promise<Response> => {
  if (!env.AI_SERVICE_TOKEN) {
    throw new AppError('AI_NOT_CONFIGURED', 'AI service is not configured', 503)
  }

  let res: Response
  try {
    res = await fetch(`${env.AI_SERVICE_URL}/v1/chat/stream`, {
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
      signal,
    })
  } catch (err: unknown) {
    // AbortError carries through so the route can tell "client disconnected"
    // apart from a real network failure.
    if (err instanceof Error && err.name === 'AbortError') throw err
    throw new AppError('AI_UNREACHABLE', 'AI service is unreachable', 502)
  }

  if (!res.ok) {
    throw new AppError('AI_REQUEST_FAILED', `AI service responded with ${res.status}`, 502)
  }

  return res
}
