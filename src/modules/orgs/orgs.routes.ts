import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  createOrgSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
} from './orgs.schema.js'
import { requireOrgMember } from './orgs.middleware.js'
import * as orgsService from './orgs.service.js'

// =============================================================================
// RESPONSE SCHEMAS (Fastify serialisation + Swagger docs)
// =============================================================================

const errorSchema = {
  type: 'object' as const,
  properties: {
    error:   { type: 'string' },
    message: { type: 'string' },
  },
}

const orgResponseSchema = {
  type: 'object' as const,
  properties: {
    id:        { type: 'string' },
    name:      { type: 'string' },
    slug:      { type: 'string' },
    logoUrl:   { type: 'string', nullable: true },
    plan:      { type: 'string' },
    isActive:  { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
  },
}

const orgMemberSchema = {
  type: 'object' as const,
  properties: {
    id:        { type: 'string' },
    userId:    { type: 'string' },
    name:      { type: 'string' },
    email:     { type: 'string' },
    avatarUrl: { type: 'string', nullable: true },
    role:      { type: 'string' },
    joinedAt:  { type: 'string', format: 'date-time' },
    isActive:  { type: 'boolean' },
  },
}

const orgDetailSchema = {
  type: 'object' as const,
  properties: {
    ...orgResponseSchema.properties,
    members: { type: 'array', items: orgMemberSchema },
  },
}

const invitationResultSchema = {
  type: 'object' as const,
  properties: {
    id:        { type: 'string' },
    email:     { type: 'string' },
    role:      { type: 'string' },
    token:     { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
    invitedBy: { type: 'string' },
  },
}

const messageSchema = {
  type: 'object' as const,
  properties: {
    message: { type: 'string' },
  },
}

// =============================================================================
// ROUTES
// =============================================================================

export const orgsRoutes = async (app: FastifyInstance) => {

  // POST /orgs — create a new organization
  app.post('/', {
    preHandler: [app.authenticate],
    schema: {
      summary:     'Create organization',
      description: 'Creates a new org and sets the calling user as owner',
      tags:        ['Orgs'],
      security:    [{ bearerAuth: [] }],
      response: {
        201: orgResponseSchema,
        400: errorSchema,
      },
    },
  }, async (req, reply) => {
    const parsed = createOrgSchema.safeParse(req.body)

    if (!parsed.success) {
      return reply.status(400).send({
        error:  'VALIDATION_ERROR',
        issues: parsed.error.issues.map((e: z.core.$ZodIssue) => ({
          field:   e.path.join('.'),
          message: e.message,
        })),
      })
    }

    const org = await orgsService.createOrg(parsed.data, req.user.userId)
    return reply.status(201).send(org)
  })


  // GET /orgs/me — list all orgs the caller belongs to
  // Registered before /:slug so Fastify matches the static segment first
  app.get('/me', {
    preHandler: [app.authenticate],
    schema: {
      summary:     'Get my organizations',
      description: 'Returns all organizations the authenticated user is an active member of',
      tags:        ['Orgs'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: { type: 'array' as const, items: orgResponseSchema },
      },
    },
  }, async (req, reply) => {
    const orgs = await orgsService.getUserOrgs(req.user.userId)
    return reply.status(200).send(orgs)
  })


  // POST /orgs/invite/accept — accept an invitation by token
  // Registered before /:slug to avoid slug capturing "invite"
  app.post('/invite/accept', {
    preHandler: [app.authenticate],
    schema: {
      summary:     'Accept invitation',
      description: 'Accepts a pending org invitation and adds the user as a member',
      tags:        ['Orgs'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: orgResponseSchema,
        400: errorSchema,
        404: errorSchema,
        410: errorSchema,
      },
    },
  }, async (req, reply) => {
    const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body)

    if (!parsed.success) {
      return reply.status(400).send({
        error:   'VALIDATION_ERROR',
        message: 'token is required',
      })
    }

    try {
      const org = await orgsService.acceptInvite(parsed.data.token, req.user.userId)
      return reply.status(200).send(org)
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message === 'INVALID_INVITE_TOKEN') {
          return reply.status(404).send({ error: 'INVALID_INVITE_TOKEN', message: 'Invitation not found' })
        }
        if (err.message === 'INVITE_ALREADY_USED') {
          return reply.status(410).send({ error: 'INVITE_ALREADY_USED', message: 'This invitation has already been used' })
        }
        if (err.message === 'INVITE_EXPIRED') {
          return reply.status(410).send({ error: 'INVITE_EXPIRED', message: 'This invitation has expired' })
        }
      }
      throw err
    }
  })


  // GET /orgs/:slug — get org with members (member-gated)
  app.get('/:slug', {
    preHandler: [requireOrgMember],
    schema: {
      summary:     'Get organization',
      description: 'Returns org details and member list — caller must be an active member',
      tags:        ['Orgs'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: orgDetailSchema,
        401: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const org = await orgsService.getOrgBySlug(slug, req.user.userId)
    return reply.status(200).send(org)
  })


  // GET /orgs/:slug/members — list active members (member-gated)
  app.get('/:slug/members', {
    preHandler: [requireOrgMember],
    schema: {
      summary:     'Get org members',
      description: 'Returns all active members of the organization',
      tags:        ['Orgs'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: { type: 'array' as const, items: orgMemberSchema },
        401: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const members = await orgsService.getOrgMembers(req.org.id)
    return reply.status(200).send(members)
  })


  // POST /orgs/:slug/invite — invite a new member (owner/admin only)
  app.post('/:slug/invite', {
    preHandler: [requireOrgMember],
    schema: {
      summary:     'Invite member',
      description: 'Sends an invitation to join the org — caller must be owner or admin',
      tags:        ['Orgs'],
      security:    [{ bearerAuth: [] }],
      response: {
        201: invitationResultSchema,
        400: errorSchema,
        403: errorSchema,
        409: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { role } = req.membership

    if (role !== 'owner' && role !== 'admin') {
      return reply.status(403).send({
        error:   'FORBIDDEN',
        message: 'Only owners and admins can invite members',
      })
    }

    const parsed = inviteMemberSchema.safeParse(req.body)

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
      const invitation = await orgsService.inviteMember(parsed.data, req.org.id, req.user.userId)
      return reply.status(201).send(invitation)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'ALREADY_MEMBER') {
        return reply.status(409).send({
          error:   'ALREADY_MEMBER',
          message: 'This user is already an active member of the organization',
        })
      }
      throw err
    }
  })


  // PATCH /orgs/:slug/members/:userId — update a member's role (owner only)
  app.patch('/:slug/members/:userId', {
    preHandler: [requireOrgMember],
    schema: {
      summary:     'Update member role',
      description: 'Changes a member\'s role — caller must be owner',
      tags:        ['Orgs'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: messageSchema,
        400: errorSchema,
        403: errorSchema,
      },
    },
  }, async (req, reply) => {
    if (req.membership.role !== 'owner') {
      return reply.status(403).send({
        error:   'FORBIDDEN',
        message: 'Only owners can change member roles',
      })
    }

    const { userId } = req.params as { slug: string; userId: string }

    const parsed = updateMemberRoleSchema.safeParse(req.body)

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
      await orgsService.updateMemberRole(req.org.id, userId, parsed.data.role, req.user.userId)
      return reply.status(200).send({ message: 'Member role updated' })
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message === 'CANNOT_CHANGE_OWN_ROLE') {
          return reply.status(403).send({ error: 'FORBIDDEN', message: 'You cannot change your own role' })
        }
        if (err.message === 'FORBIDDEN') {
          return reply.status(403).send({ error: 'FORBIDDEN', message: 'Insufficient permissions' })
        }
      }
      throw err
    }
  })


  // DELETE /orgs/:slug/members/:userId — remove a member (owner or admin)
  app.delete('/:slug/members/:userId', {
    preHandler: [requireOrgMember],
    schema: {
      summary:     'Remove member',
      description: 'Removes a member from the org — caller must be owner or admin',
      tags:        ['Orgs'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: messageSchema,
        403: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { role } = req.membership

    if (role !== 'owner' && role !== 'admin') {
      return reply.status(403).send({
        error:   'FORBIDDEN',
        message: 'Only owners and admins can remove members',
      })
    }

    const { userId } = req.params as { slug: string; userId: string }

    try {
      await orgsService.removeMember(req.org.id, userId, req.user.userId)
      return reply.status(200).send({ message: 'Member removed' })
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message === 'CANNOT_REMOVE_SELF') {
          return reply.status(403).send({ error: 'FORBIDDEN', message: 'You cannot remove yourself' })
        }
        if (err.message === 'FORBIDDEN') {
          return reply.status(403).send({ error: 'FORBIDDEN', message: 'Insufficient permissions' })
        }
      }
      throw err
    }
  })
}
