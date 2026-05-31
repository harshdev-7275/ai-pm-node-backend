import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  createIssueSchema,
  updateIssueSchema,
  updateIssueStatusSchema,
} from './issues.schema.js'
import { requireOrgMember } from '../orgs/orgs.middleware.js'
import * as issuesService from './issues.service.js'

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
// ROUTES
// Registered under /orgs/:slug/projects/:projectId/issues in app.ts
// requireOrgMember handles JWT + org lookup + membership — attaches req.org
// =============================================================================

export const issuesRoutes = async (app: FastifyInstance) => {

  // GET /issues — list all active issues for the project
  app.get('/', {
    preHandler: [requireOrgMember],
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
    const list = await issuesService.getIssuesByProject(projectId)
    return reply.status(200).send(list)
  })


  // GET /issues/statuses — list issue statuses for the project (board columns)
  app.get('/statuses', {
    preHandler: [requireOrgMember],
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
    preHandler: [requireOrgMember],
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
      const issue = await issuesService.createIssue(
        parsed.data,
        projectId,
        req.org.id,
        req.user.userId,
      )
      return reply.status(201).send(issue)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'PROJECT_NOT_FOUND') {
        return reply.status(404).send({ error: 'PROJECT_NOT_FOUND', message: 'Project not found' })
      }
      throw err
    }
  })


  // GET /issues/:issueId — get issue with full detail
  app.get('/:issueId', {
    preHandler: [requireOrgMember],
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
    const { issueId } = req.params as { slug: string; projectId: string; issueId: string }

    try {
      const issue = await issuesService.getIssueById(issueId)
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
    preHandler: [requireOrgMember],
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
    const { issueId } = req.params as { slug: string; projectId: string; issueId: string }

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
      const issue = await issuesService.updateIssue(issueId, parsed.data)
      return reply.status(200).send(issue)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'ISSUE_NOT_FOUND') {
        return reply.status(404).send({ error: 'ISSUE_NOT_FOUND', message: 'Issue not found' })
      }
      throw err
    }
  })


  // PATCH /issues/:issueId/status — update status only (board drag-and-drop)
  app.patch('/:issueId/status', {
    preHandler: [requireOrgMember],
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
    const { issueId } = req.params as { slug: string; projectId: string; issueId: string }

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
      const issue = await issuesService.updateIssueStatus(issueId, parsed.data)
      return reply.status(200).send(issue)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'ISSUE_NOT_FOUND') {
        return reply.status(404).send({ error: 'ISSUE_NOT_FOUND', message: 'Issue not found' })
      }
      throw err
    }
  })


  // DELETE /issues/:issueId — soft delete
  app.delete('/:issueId', {
    preHandler: [requireOrgMember],
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
    const { issueId } = req.params as { slug: string; projectId: string; issueId: string }

    try {
      await issuesService.deleteIssue(issueId)
      return reply.status(200).send({ message: 'Issue deleted' })
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'ISSUE_NOT_FOUND') {
        return reply.status(404).send({ error: 'ISSUE_NOT_FOUND', message: 'Issue not found' })
      }
      throw err
    }
  })
}
