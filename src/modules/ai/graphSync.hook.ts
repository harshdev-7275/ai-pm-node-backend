import type { FastifyRequest, FastifyReply } from 'fastify'

export interface GraphSyncHookDeps {
  /** Fire an incremental single-project sync (caller supplies a debounced fn). */
  syncProject: (orgId: string, orgSlug: string, projectId: string) => void
  /** Fire a full org sync (caller supplies a debounced fn). */
  syncOrg: (orgId: string, orgSlug: string) => void
}

// Reads never change data, so they never need a resync.
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Build a Fastify `onResponse` hook that keeps the ai-service knowledge graph
 * fresh by scheduling a graph sync after every *successful mutation* of
 * project-scoped data. Registered globally; it self-filters:
 *
 *  - Skips reads (GET/HEAD/OPTIONS) and any non-2xx response.
 *  - Skips requests with no resolved `req.org` or no `:projectId` param — e.g.
 *    auth/health/org-level routes, and project *creation* (which fires its own
 *    full sync explicitly, and has no :projectId to key on).
 *  - Routes under `.../issues` (issues + comments, which are nested there) →
 *    incremental project sync. Everything else project-scoped (sprints,
 *    statuses, categories, project settings, members) → full org sync, because
 *    the incremental sync only re-syncs a project's issues.
 *
 * The hook never throws and never awaits sync work — it only schedules it, so a
 * slow or down ai-service can never affect the user's response.
 */
export function createGraphSyncHook(
  deps: GraphSyncHookDeps,
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function graphSyncHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (READ_METHODS.has(req.method)) return
    if (reply.statusCode < 200 || reply.statusCode >= 300) return

    // `req.org` is declared always-set, but it is only populated by the
    // org/project auth guards — absent on unauthenticated routes this global
    // hook also sees. Guard at runtime regardless of the ambient type.
    if (!req.org?.id || !req.org.slug) return

    const { projectId } = req.params as { projectId?: string }
    if (!projectId) return

    const routeUrl = req.routeOptions?.url ?? ''
    if (routeUrl.includes('/issues')) {
      deps.syncProject(req.org.id, req.org.slug, projectId)
    } else {
      deps.syncOrg(req.org.id, req.org.slug)
    }
  }
}
