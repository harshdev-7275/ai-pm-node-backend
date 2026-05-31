import type { FastifyInstance } from 'fastify'
import { createSprintSchema, updateSprintSchema } from './sprints.schema.js'
import { requireOrgMember } from '../orgs/orgs.middleware.js'
import * as sprintsService from './sprints.service.js'

// =============================================================================
// RESPONSE SCHEMAS (Fastify serialisation)
// =============================================================================

const errorSchema = {
  type: 'object' as const,
  properties: { error: { type: 'string' }, message: { type: 'string' } },
}

const sprintResponseSchema = {
  type: 'object' as const,
  properties: {
    id:        { type: 'string' },
    projectId: { type: 'string' },
    orgId:     { type: 'string' },
    name:      { type: 'string' },
    goal:      { type: 'string', nullable: true },
    status:    { type: 'string' },
    startDate: { type: 'string', nullable: true },
    endDate:   { type: 'string', nullable: true },
    createdBy: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
}

const sprintIssueSchema = {
  type: 'object' as const,
  properties: {
    id:          { type: 'string' },
    number:      { type: 'number' },
    title:       { type: 'string' },
    type:        { type: 'string' },
    priority:    { type: 'string' },
    statusId:    { type: 'string' },
    assigneeId:  { type: 'string', nullable: true },
    storyPoints: { type: 'number', nullable: true },
  },
}

const sprintDetailSchema = {
  type: 'object' as const,
  properties: {
    ...sprintResponseSchema.properties,
    issues:      { type: 'array', items: sprintIssueSchema },
    issueCount:  { type: 'number' },
    pointsTotal: { type: 'number' },
  },
}

// =============================================================================
// ROUTES
// Registered at prefix: /orgs/:slug/projects/:projectId/sprints
// =============================================================================

export async function sprintsRoutes(app: FastifyInstance): Promise<void> {
  // GET / — list all sprints for a project
  app.get('/', {
    onRequest:  [requireOrgMember],
    schema: {
      tags:     ['Sprints'],
      summary:  'List sprints',
      security: [{ bearerAuth: [] }],
      response: {
        200: { type: 'array', items: sprintResponseSchema },
        403: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string }
    const result = await sprintsService.listSprints(projectId)
    return reply.status(200).send(result)
  })

  // POST / — create a sprint
  app.post('/', {
    onRequest:  [requireOrgMember],
    schema: {
      tags:     ['Sprints'],
      summary:  'Create sprint',
      security: [{ bearerAuth: [] }],
      body:     createSprintSchema,
      response: {
        201: sprintResponseSchema,
        400: errorSchema,
        403: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, slug } = req.params as { projectId: string; slug: string }
    const input = createSprintSchema.parse(req.body)
    const result = await sprintsService.createSprint(input, projectId, req.org.id, req.user.userId)
    return reply.status(201).send(result)
  })

  // GET /:sprintId — get sprint detail with issues
  app.get('/:sprintId', {
    onRequest:  [requireOrgMember],
    schema: {
      tags:     ['Sprints'],
      summary:  'Get sprint detail',
      security: [{ bearerAuth: [] }],
      response: {
        200: sprintDetailSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, sprintId } = req.params as { projectId: string; sprintId: string }
    const result = await sprintsService.getSprintDetail(projectId, sprintId)
    return reply.status(200).send(result)
  })

  // PATCH /:sprintId — update sprint name/goal/dates
  app.patch('/:sprintId', {
    onRequest:  [requireOrgMember],
    schema: {
      tags:     ['Sprints'],
      summary:  'Update sprint',
      security: [{ bearerAuth: [] }],
      body:     updateSprintSchema,
      response: {
        200: sprintResponseSchema,
        400: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, sprintId } = req.params as { projectId: string; sprintId: string }
    const input = updateSprintSchema.parse(req.body)
    const result = await sprintsService.updateSprint(projectId, sprintId, input)
    return reply.status(200).send(result)
  })

  // DELETE /:sprintId — delete sprint (moves issues to backlog)
  app.delete('/:sprintId', {
    onRequest:  [requireOrgMember],
    schema: {
      tags:     ['Sprints'],
      summary:  'Delete sprint',
      security: [{ bearerAuth: [] }],
      response: {
        204: { type: 'null' },
        400: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, sprintId } = req.params as { projectId: string; sprintId: string }
    await sprintsService.deleteSprint(projectId, sprintId)
    return reply.status(204).send()
  })

  // POST /:sprintId/start — transition planned → active
  app.post('/:sprintId/start', {
    onRequest:  [requireOrgMember],
    schema: {
      tags:     ['Sprints'],
      summary:  'Start sprint',
      security: [{ bearerAuth: [] }],
      response: {
        200: sprintResponseSchema,
        400: errorSchema,
        403: errorSchema,
        404: errorSchema,
        409: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, sprintId } = req.params as { projectId: string; sprintId: string }
    const result = await sprintsService.startSprint(projectId, sprintId)
    return reply.status(200).send(result)
  })

  // POST /:sprintId/complete — transition active → completed
  app.post('/:sprintId/complete', {
    onRequest:  [requireOrgMember],
    schema: {
      tags:     ['Sprints'],
      summary:  'Complete sprint',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object' as const,
        properties: { moveIncomplete: { type: 'boolean' } },
      },
      response: {
        200: sprintResponseSchema,
        400: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, sprintId } = req.params as { projectId: string; sprintId: string }
    const { moveIncomplete = true } = (req.body ?? {}) as { moveIncomplete?: boolean }
    const result = await sprintsService.completeSprint(projectId, sprintId, moveIncomplete)
    return reply.status(200).send(result)
  })

  // POST /:sprintId/issues/:issueId — add issue to sprint
  app.post('/:sprintId/issues/:issueId', {
    onRequest:  [requireOrgMember],
    schema: {
      tags:     ['Sprints'],
      summary:  'Add issue to sprint',
      security: [{ bearerAuth: [] }],
      response: {
        204: { type: 'null' },
        400: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, sprintId, issueId } = req.params as { projectId: string; sprintId: string; issueId: string }
    await sprintsService.addIssueToSprint(projectId, sprintId, issueId)
    return reply.status(204).send()
  })

  // DELETE /:sprintId/issues/:issueId — remove issue from sprint (back to backlog)
  app.delete('/:sprintId/issues/:issueId', {
    onRequest:  [requireOrgMember],
    schema: {
      tags:     ['Sprints'],
      summary:  'Remove issue from sprint',
      security: [{ bearerAuth: [] }],
      response: {
        204: { type: 'null' },
        400: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, sprintId, issueId } = req.params as { projectId: string; sprintId: string; issueId: string }
    await sprintsService.removeIssueFromSprint(projectId, sprintId, issueId)
    return reply.status(204).send()
  })
}
