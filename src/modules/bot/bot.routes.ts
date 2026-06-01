import type { FastifyInstance } from 'fastify'
import { db } from '../../db/index.js'
import { organizations } from '../../db/schema.js'
import { eq } from 'drizzle-orm'
import { botAuth } from '../../middleware/botAuth.js'
import { getIssuesByProject, getIssueStatuses } from '../issues/issues.service.js'
import { listSprints, addIssueToSprint } from '../sprints/sprints.service.js'
import { getOrgMembers } from '../orgs/orgs.service.js'

// =============================================================================
// BOT ROUTES — read-only, protected by X-Bot-Secret
// Registered under /bot in app.ts
// AI service uses these for context lookups — no user JWT required
// =============================================================================

export const botRoutes = async (app: FastifyInstance) => {

  // GET /bot/orgs/:slug/projects/:projectId/statuses
  app.get('/orgs/:slug/projects/:projectId/statuses', {
    preHandler: [botAuth],
    schema: {
      summary:  'Bot — list workflow statuses',
      tags:     ['Bot'],
      security: [{ botSecret: [] }],
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { slug: string; projectId: string }
    const statuses = await getIssueStatuses(projectId)
    return reply.status(200).send(statuses)
  })


  // GET /bot/orgs/:slug/projects/:projectId/issues
  app.get('/orgs/:slug/projects/:projectId/issues', {
    preHandler: [botAuth],
    schema: {
      summary:  'Bot — list issues',
      tags:     ['Bot'],
      security: [{ botSecret: [] }],
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { slug: string; projectId: string }
    const issues = await getIssuesByProject(projectId)
    return reply.status(200).send(issues)
  })


  // GET /bot/orgs/:slug/projects/:projectId/sprints
  app.get('/orgs/:slug/projects/:projectId/sprints', {
    preHandler: [botAuth],
    schema: {
      summary:  'Bot — list sprints',
      tags:     ['Bot'],
      security: [{ botSecret: [] }],
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { slug: string; projectId: string }
    const sprints = await listSprints(projectId)
    return reply.status(200).send(sprints)
  })


  // POST /bot/orgs/:slug/projects/:projectId/sprints/:sprintId/issues/:issueId
  app.post('/orgs/:slug/projects/:projectId/sprints/:sprintId/issues/:issueId', {
    preHandler: [botAuth],
    schema: {
      summary:  'Bot — add issue to sprint',
      tags:     ['Bot'],
      security: [{ botSecret: [] }],
    },
  }, async (req, reply) => {
    const { projectId, sprintId, issueId } = req.params as { slug: string; projectId: string; sprintId: string; issueId: string }
    await addIssueToSprint(projectId, sprintId, issueId)
    return reply.status(204).send()
  })


  // GET /bot/orgs/:slug/members
  app.get('/orgs/:slug/members', {
    preHandler: [botAuth],
    schema: {
      summary:  'Bot — list org members',
      tags:     ['Bot'],
      security: [{ botSecret: [] }],
    },
  }, async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1)
    if (!org) {
      return reply.status(404).send({ error: 'ORG_NOT_FOUND', message: 'Organization not found' })
    }
    const members = await getOrgMembers(org.id)
    return reply.status(200).send(members)
  })
}
