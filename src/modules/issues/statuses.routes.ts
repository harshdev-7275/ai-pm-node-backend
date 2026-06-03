import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireProjectAccess } from '../../middleware/requireProjectAccess.js'
import { createStatusSchema, updateStatusSchema } from './issues.schema.js'
import * as statusesService from './statuses.service.js'

// =============================================================================
// RESPONSE SCHEMAS (Fastify serialization shapes)
// =============================================================================

const errorSchema = {
  type: 'object' as const,
  properties: {
    error:   { type: 'string' },
    message: { type: 'string' },
  },
}

const statusResponseSchema = {
  type: 'object' as const,
  properties: {
    id:        { type: 'string' },
    projectId: { type: 'string' },
    name:      { type: 'string' },
    color:     { type: 'string' },
    position:  { type: 'number' },
    isDefault: { type: 'boolean' },
    category:  { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
}

// =============================================================================
// ROUTES
// Registered under /orgs/:slug/projects/:projectId/statuses in app.ts
// =============================================================================

export const statusesRoutes = async (app: FastifyInstance) => {

  // GET / — list statuses ordered by position (any org member)
  app.get('/', {
    preHandler: [requireProjectAccess('viewer')],
    schema: {
      summary:     'List workflow statuses',
      description: 'Returns all statuses for this project ordered by position',
      tags:        ['Statuses'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: { type: 'array' as const, items: statusResponseSchema },
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { slug: string; projectId: string }
    const statuses = await statusesService.getStatuses(projectId)
    return reply.status(200).send(statuses)
  })


  // POST / — create a new status (workflow managers only)
  app.post('/', {
    preHandler: [requireProjectAccess('lead')],
    schema: {
      summary:     'Create workflow status',
      description: 'Creates a new status for this project. Position is auto-assigned.',
      tags:        ['Statuses'],
      security:    [{ bearerAuth: [] }],
      response: {
        201: statusResponseSchema,
        400: errorSchema,
        403: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { slug: string; projectId: string }

    const parsed = createStatusSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error:  'VALIDATION_ERROR',
        issues: parsed.error.issues.map((e: z.core.$ZodIssue) => ({
          field:   e.path.join('.'),
          message: e.message,
        })),
      })
    }

    const status = await statusesService.createStatus(parsed.data, projectId)
    return reply.status(201).send(status)
  })


  // PATCH /:id — rename, recolor, or reorder (workflow managers only)
  app.patch('/:id', {
    preHandler: [requireProjectAccess('lead')],
    schema: {
      summary:     'Update workflow status',
      description: 'Rename, recolor, or reorder a status. All fields are optional.',
      tags:        ['Statuses'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: statusResponseSchema,
        400: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, id } = req.params as { slug: string; projectId: string; id: string }

    const parsed = updateStatusSchema.safeParse(req.body)
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
      const status = await statusesService.updateStatus(id, projectId, parsed.data)
      return reply.status(200).send(status)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'STATUS_NOT_FOUND') {
        return reply.status(404).send({ error: 'STATUS_NOT_FOUND', message: 'Status not found' })
      }
      throw err
    }
  })


  // DELETE /:id — delete with two safety checks (workflow managers only)
  app.delete('/:id', {
    preHandler: [requireProjectAccess('lead')],
    schema: {
      summary:     'Delete workflow status',
      description: 'Deletes a status. Blocked if issues are still assigned or it is the last one.',
      tags:        ['Statuses'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: { type: 'object' as const, properties: { message: { type: 'string' } } },
        400: errorSchema,
        403: errorSchema,
        404: errorSchema,
        409: {
          type: 'object' as const,
          properties: {
            error:      { type: 'string' },
            message:    { type: 'string' },
            issueCount: { type: 'number' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { projectId, id } = req.params as { slug: string; projectId: string; id: string }

    try {
      await statusesService.deleteStatus(id, projectId)
      return reply.status(200).send({ message: 'Status deleted' })
    } catch (err: unknown) {
      if (!(err instanceof Error)) throw err

      switch (err.message) {
        case 'STATUS_NOT_FOUND':
          return reply.status(404).send({ error: 'STATUS_NOT_FOUND', message: 'Status not found' })
        case 'LAST_STATUS':
          return reply.status(400).send({
            error:   'LAST_STATUS',
            message: 'Cannot delete the last status — a project must always have at least one',
          })
        case 'STATUS_HAS_ISSUES':
          return reply.status(409).send({
            error:      'STATUS_HAS_ISSUES',
            message:    'Move issues out of this status before deleting it',
            issueCount: (err as Error & { issueCount: number }).issueCount,
          })
        default:
          throw err
      }
    }
  })

}
