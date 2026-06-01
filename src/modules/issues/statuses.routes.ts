import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { requireOrgMember, requireBotOrMember } from '../orgs/orgs.middleware.js'
import { getProjectMemberRole } from '../projects/projects.service.js'
import { createStatusSchema, updateStatusSchema } from './issues.schema.js'
import * as statusesService from './statuses.service.js'

// =============================================================================
// ROLE GUARD
// Allowed: org owner, org admin, or project lead.
// requireOrgMember must run first — it populates req.org and req.membership.
// =============================================================================

async function requireWorkflowManager(
  req:   FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const orgRole = req.membership.role
  if (orgRole === 'owner' || orgRole === 'admin') return

  const { projectId } = req.params as { projectId: string }
  const projectRole = await getProjectMemberRole(projectId, req.user.userId)
  if (projectRole === 'lead') return

  reply.status(403).send({
    error:   'FORBIDDEN',
    message: 'Only owners, admins, or project leads can manage workflow statuses',
  })
}

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
    preHandler: [requireOrgMember],
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
    preHandler: [requireOrgMember, requireWorkflowManager],
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
    preHandler: [requireOrgMember, requireWorkflowManager],
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
    preHandler: [requireOrgMember, requireWorkflowManager],
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
