import { env } from '../config/env.js'
import { logger } from './logger.js'

// =============================================================================
// GRAPH EVENTS — best-effort push of entity changes to the AI service
// On direct (non-bot) REST writes, the AI bot path never runs, so Neo4j would
// drift from Postgres until the next full /graph/sync. Emitting a small event
// here keeps the knowledge graph in step incrementally.
// =============================================================================

export type GraphEntity = 'issue' | 'project' | 'sprint' | 'user' | 'member'

/**
 * Fire-and-forget a single entity change to the AI service's /graph/events.
 *
 * The graph is optional infrastructure (per AIService.md), so a slow or
 * unreachable AI service must never delay or fail the user's write. Nothing is
 * awaited by the caller; transport errors are logged and swallowed. The AI side
 * is also best-effort — it always answers 200 and drops the event if Neo4j is
 * down — so there is nothing for the caller to react to.
 */
// `data` is any serialisable entity object (e.g. IssueResponse / SprintResponse).
// `object` rather than Record<string, unknown> so the typed response interfaces,
// which have no index signature, pass without a cast at every call site.
export function emitGraphEvent(entity: GraphEntity, data: object): void {
  void (async () => {
    try {
      await fetch(`${env.AI_SERVICE_URL}/graph/events`, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'X-Internal-Secret': env.INTERNAL_SECRET,
        },
        body: JSON.stringify({ entity, data }),
      })
    } catch (err) {
      logger.warn({ err, entity }, 'graph event emit failed')
    }
  })()
}
