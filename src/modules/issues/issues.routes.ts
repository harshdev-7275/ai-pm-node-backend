import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/index.js'
import { organizations, organizationMembers, users } from '../../db/schema.js'
import {
  createIssueSchema,
  updateIssueSchema,
  updateIssueStatusSchema,
} from './issues.schema.js'
import { requireProjectAccess } from '../../middleware/requireProjectAccess.js'
import * as issuesService from './issues.service.js'
import { addClient, removeClient, broadcast } from './issues.sse.js'
import { env } from '../../config/env.js'

// =============================================================================
// RESPONSE SCHEMAS
// =============================================================================

const errorSchema = {
  type: 'object' as const,
  properties: { error: { type: 'string' }, message: { type: 'string' } },
}

const messageSchema = {
  type: 'object' as const,
  properties: { message: { type: 'string' } },
}

const issueResponseSchema = {
  type: 'object' as const,
  properties: {
    id:             { type: 'string' },
    projectId:      { type: 'string' },
    orgId:          { type: 'string' },
    number:         { type: 'number' },
    title:          { type: 'string' },
    description:    { type: 'string', nullable: true },
    type:           { type: 'string' },
    categoryId:     { type: 'string' },
    priority:       { type: 'string' },
    statusId:       { type: 'string' },
    assigneeId:     { type: 'string', nullable: true },
    reporterId:     { type: 'string' },
    parentId:       { type: 'string', nullable: true },
    sprintId:       { type: 'string', nullable: true },
    storyPoints:    { type: 'number', nullable: true },
    estimatedHours: { type: 'number', nullable: true },
    actualHours:    { type: 'number', nullable: true },
    dueDate:        { type: 'string', nullable: true },
    startedAt:      { type: 'string', nullable: true },
    completedAt:    { type: 'string', nullable: true },
    createdAt:      { type: 'string', format: 'date-time' },
    updatedAt:      { type: 'string', format: 'date-time' },
  },
}

const statusSchema = {
  type: 'object' as const,
  properties: {
    id:       { type: 'string' },
    name:     { type: 'string' },
    color:    { type: 'string' },
    position: { type: 'number' },
    category: { type: 'string' },
  },
}

const issueUserSchema = {
  type: 'object' as const,
  properties: {
    id:        { type: 'string' },
    name:      { type: 'string' },
    email:     { type: 'string' },
    avatarUrl: { type: 'string', nullable: true },
  },
}

const issueDetailSchema = {
  type: 'object' as const,
  properties: {
    ...issueResponseSchema.properties,
    status:   statusSchema,
    assignee: { ...issueUserSchema, nullable: true },
    reporter: issueUserSchema,
  },
}

// =============================================================================
// HELPERS
// =============================================================================

// Subtask hierarchy violations from issues.service — all client errors (400)
const PARENT_ERRORS: Record<string, string> = {
  PARENT_NOT_FOUND:   'Parent issue not found in this project',
  PARENT_NOT_ALLOWED: 'Only subtasks can have a parent issue',
  PARENT_IS_SUBTASK:  'A subtask cannot be the parent of another issue',
}

function mapParentError(err: unknown): { error: string; message: string } | null {
  if (err instanceof Error && err.message in PARENT_ERRORS) {
    return { error: err.message, message: PARENT_ERRORS[err.message]! }
  }
  return null
}

async function getActorName(userId: string): Promise<string> {
  const [user] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return user?.name ?? 'Someone'
}

// =============================================================================
// ROUTES
// Registered under /orgs/:slug/projects/:projectId/issues in app.ts
// requireOrgMember handles JWT + org lookup + membership — attaches req.org
// =============================================================================

export const issuesRoutes = async (app: FastifyInstance) => {

  // GET /issues — list all active issues for the project
  app.get('/', {
    preHandler: [requireProjectAccess('viewer')],
    schema: {
      summary:     'List issues',
      description: 'Returns all active issues for the project ordered by number',
      tags:        ['Issues'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: { type: 'array' as const, items: issueResponseSchema },
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { slug: string; projectId: string }
    const { limit, offset } = req.query as { limit?: string; offset?: string }
    const list = await issuesService.getIssuesByProject(projectId, {
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
    })
    return reply.status(200).send(list)
  })


  // GET /issues/statuses — list issue statuses for the project (board columns)
  app.get('/statuses', {
    preHandler: [requireProjectAccess('viewer')],
    schema: {
      summary:     'Get issue statuses',
      description: 'Returns the workflow statuses (board columns) for this project',
      tags:        ['Issues'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: { type: 'array' as const, items: statusSchema },
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { slug: string; projectId: string }
    const statuses = await issuesService.getIssueStatuses(projectId)
    return reply.status(200).send(statuses)
  })


  // POST /issues — create a new issue
  app.post('/', {
    preHandler: [requireProjectAccess('member')],
    schema: {
      summary:     'Create issue',
      description: 'Creates a new issue in the project with an auto-incremented number',
      tags:        ['Issues'],
      security:    [{ bearerAuth: [] }],
      response: {
        201: issueResponseSchema,
        400: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { slug: string; projectId: string }

    const parsed = createIssueSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error:  'VALIDATION_ERROR',
        issues: parsed.error.issues.map((e: z.core.$ZodIssue) => ({
          field:   e.path.join('.'),
          message: e.message,
        })),
      })
    }

    try {
      // req.user is always set after requireProjectAccess — synthesized on the
      // bot path, full TokenPayload on the user path. See middleware and
      // types/fastify.d.ts.
      const actorId = req.user.userId
      const issue = await issuesService.createIssue(
        parsed.data,
        projectId,
        req.org.id,
        actorId,
      )
      const actorName = await getActorName(actorId)
      broadcast(projectId, { type: 'ISSUE_CREATED', issue, actorId, actorName })
      return reply.status(201).send(issue)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'PROJECT_NOT_FOUND') {
        return reply.status(404).send({ error: 'PROJECT_NOT_FOUND', message: 'Project not found' })
      }
      const parentError = mapParentError(err)
      if (parentError) return reply.status(400).send(parentError)
      throw err
    }
  })


  // GET /issues/:issueId — get issue with full detail
  app.get('/:issueId', {
    preHandler: [requireProjectAccess('viewer')],
    schema: {
      summary:     'Get issue',
      description: 'Returns full issue detail including status, assignee and reporter',
      tags:        ['Issues'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: issueDetailSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, issueId } = req.params as { slug: string; projectId: string; issueId: string }

    try {
      const issue = await issuesService.getIssueById(projectId, issueId)
      return reply.status(200).send(issue)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'ISSUE_NOT_FOUND') {
        return reply.status(404).send({ error: 'ISSUE_NOT_FOUND', message: 'Issue not found' })
      }
      throw err
    }
  })


  // PATCH /issues/:issueId — update issue fields
  app.patch('/:issueId', {
    preHandler: [requireProjectAccess('member')],
    schema: {
      summary:     'Update issue',
      description: 'Updates any field on an issue',
      tags:        ['Issues'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: issueResponseSchema,
        400: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, issueId } = req.params as { slug: string; projectId: string; issueId: string }

    const parsed = updateIssueSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error:  'VALIDATION_ERROR',
        issues: parsed.error.issues.map((e: z.core.$ZodIssue) => ({
          field:   e.path.join('.'),
          message: e.message,
        })),
      })
    }

    try {
      const actorId = req.user.userId
      const issue = await issuesService.updateIssue(projectId, issueId, parsed.data, actorId)
      // Board-visible changes (status/category moves from drag, edits) must
      // reach other connected boards in real time
      const actorName = await getActorName(actorId)
      broadcast(projectId, { type: 'ISSUE_UPDATED', issue, actorId, actorName })
      return reply.status(200).send(issue)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'ISSUE_NOT_FOUND') {
        return reply.status(404).send({ error: 'ISSUE_NOT_FOUND', message: 'Issue not found' })
      }
      if (err instanceof Error && err.message === 'STATUS_NOT_FOUND') {
        return reply.status(400).send({ error: 'STATUS_NOT_FOUND', message: 'Status does not belong to this project' })
      }
      const parentError = mapParentError(err)
      if (parentError) return reply.status(400).send(parentError)
      throw err
    }
  })


  // PATCH /issues/:issueId/status — update status only (board drag-and-drop)
  app.patch('/:issueId/status', {
    preHandler: [requireProjectAccess('member')],
    schema: {
      summary:     'Update issue status',
      description: 'Moves an issue to a different status column — used by board drag-and-drop',
      tags:        ['Issues'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: issueResponseSchema,
        400: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, issueId } = req.params as { slug: string; projectId: string; issueId: string }

    const parsed = updateIssueStatusSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error:  'VALIDATION_ERROR',
        issues: parsed.error.issues.map((e: z.core.$ZodIssue) => ({
          field:   e.path.join('.'),
          message: e.message,
        })),
      })
    }

    try {
      // req.user is always set after requireProjectAccess (see middleware).
      const actorId = req.user.userId
      const issue = await issuesService.updateIssueStatus(projectId, issueId, parsed.data, actorId)
      const actorName = await getActorName(actorId)
      broadcast(projectId, {
        type:      'ISSUE_STATUS_UPDATED',
        issueId:   issue.id,
        statusId:  issue.statusId,
        actorId,
        actorName,
      })
      return reply.status(200).send(issue)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'ISSUE_NOT_FOUND') {
        return reply.status(404).send({ error: 'ISSUE_NOT_FOUND', message: 'Issue not found' })
      }
      if (err instanceof Error && err.message === 'STATUS_NOT_FOUND') {
        return reply.status(400).send({ error: 'STATUS_NOT_FOUND', message: 'Status does not belong to this project' })
      }
      throw err
    }
  })


  // GET /issues/events — SSE stream for real-time board updates
  // Auth via ?token= query param because EventSource cannot set headers
  app.get('/events', async (req, reply) => {
    const { token } = req.query as { token?: string }
    if (!token) return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Token required' })

    let payload: { userId: string; email: string; sessionId: string }
    try {
      payload = app.jwt.verify<{ userId: string; email: string; sessionId: string }>(token)
    } catch {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid token' })
    }

    // Inline org membership check — cannot use requireOrgMember because it
    // calls req.jwtVerify() which reads Authorization header, absent on SSE requests
    const { slug, projectId } = req.params as { slug: string; projectId: string }

    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1)

    if (!org) return reply.status(404).send({ error: 'ORG_NOT_FOUND', message: 'Organization not found' })

    const [membership] = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(and(
        eq(organizationMembers.orgId, org.id),
        eq(organizationMembers.userId, payload.userId),
        eq(organizationMembers.isActive, true),
      ))
      .limit(1)

    if (!membership) return reply.status(403).send({ error: 'FORBIDDEN', message: 'Not a member of this organization' })

    // SSE headers — CORS must be set manually because reply.raw bypasses @fastify/cors
    const requestOrigin  = req.headers.origin ?? ''
    const allowedOrigins = env.CORS_ORIGIN.split(',').map((o: string) => o.trim())
    const corsOrigin     = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0] ?? '*'

    reply.raw.setHeader('Access-Control-Allow-Origin',      corsOrigin)
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true')
    reply.raw.setHeader('Content-Type',      'text/event-stream')
    reply.raw.setHeader('Cache-Control',     'no-cache')
    reply.raw.setHeader('Connection',        'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.raw.flushHeaders()

    // Send initial connected event
    reply.raw.write(`data: ${JSON.stringify({ type: 'CONNECTED' })}\n\n`)

    addClient(projectId, reply.raw)

    // Heartbeat every 25s keeps the connection alive through proxies/load balancers
    const heartbeat = setInterval(() => {
      try { reply.raw.write(': ping\n\n') } catch { clearInterval(heartbeat) }
    }, 25_000)

    req.raw.on('close', () => {
      clearInterval(heartbeat)
      removeClient(projectId, reply.raw)
    })

    // Keep the handler open — Fastify will not auto-close the response
    await new Promise<void>(() => {})
  })


  // GET /issues/:issueId/history — full audit trail for an issue
  app.get('/:issueId/history', {
    preHandler: [requireProjectAccess('viewer')],
    schema: {
      summary:     'Get issue history',
      description: 'Returns the complete audit trail for an issue, newest changes first',
      tags:        ['Issues'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              id:           { type: 'string' },
              issueId:      { type: 'string' },
              fieldChanged: { type: 'string' },
              oldValue:     { type: 'string', nullable: true },
              newValue:     { type: 'string', nullable: true },
              changedAt:    { type: 'string', format: 'date-time' },
              changedBy: {
                type: 'object' as const,
                properties: {
                  id:        { type: 'string' },
                  name:      { type: 'string' },
                  avatarUrl: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, issueId } = req.params as { slug: string; projectId: string; issueId: string }
    const history = await issuesService.getIssueHistory(projectId, issueId)
    return reply.status(200).send(history)
  })


  // DELETE /issues/:issueId — soft delete
  app.delete('/:issueId', {
    preHandler: [requireProjectAccess('member')],
    schema: {
      summary:     'Delete issue',
      description: 'Soft-deletes an issue — it remains in the DB for audit history',
      tags:        ['Issues'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: messageSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, issueId } = req.params as { slug: string; projectId: string; issueId: string }

    try {
      await issuesService.deleteIssue(projectId, issueId)
      return reply.status(200).send({ message: 'Issue deleted' })
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'ISSUE_NOT_FOUND') {
        return reply.status(404).send({ error: 'ISSUE_NOT_FOUND', message: 'Issue not found' })
      }
      throw err
    }
  })
}
