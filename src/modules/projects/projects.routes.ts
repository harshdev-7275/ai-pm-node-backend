import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  createProjectSchema,
  updateProjectSchema,
  addProjectMemberSchema,
  updateProjectMemberRoleSchema,
} from './projects.schema.js'
import { requireOrgMember } from '../orgs/orgs.middleware.js'
import * as projectsService from './projects.service.js'

// =============================================================================
// RESPONSE SCHEMAS
// =============================================================================

const errorSchema = {
  type: 'object' as const,
  properties: {
    error:   { type: 'string' },
    message: { type: 'string' },
  },
}

const projectMemberSchema = {
  type: 'object' as const,
  properties: {
    id:        { type: 'string' },
    userId:    { type: 'string' },
    name:      { type: 'string' },
    email:     { type: 'string' },
    avatarUrl: { type: 'string', nullable: true },
    role:      { type: 'string' },
    addedAt:   { type: 'string', format: 'date-time' },
  },
}

const projectResponseSchema = {
  type: 'object' as const,
  properties: {
    id:          { type: 'string' },
    orgId:       { type: 'string' },
    name:        { type: 'string' },
    key:         { type: 'string' },
    description: { type: 'string', nullable: true },
    icon:        { type: 'string', nullable: true },
    color:       { type: 'string', nullable: true },
    isArchived:  { type: 'boolean' },
    createdBy:   { type: 'string' },
    createdAt:   { type: 'string', format: 'date-time' },
  },
}

const projectDetailSchema = {
  type: 'object' as const,
  properties: {
    ...projectResponseSchema.properties,
    members: { type: 'array', items: projectMemberSchema },
  },
}

const messageSchema = {
  type: 'object' as const,
  properties: { message: { type: 'string' } },
}

// =============================================================================
// HELPERS
// =============================================================================

// Returns true if the requesting user can manage project membership.
// Allowed when they are an org owner/admin OR the project lead.
const canManageProjectMembers = async (
  orgRole: string,
  projectId: string,
  userId: string,
): Promise<boolean> => {
  if (orgRole === 'owner' || orgRole === 'admin') return true
  const projectRole = await projectsService.getProjectMemberRole(projectId, userId)
  return projectRole === 'lead'
}

// =============================================================================
// ROUTES
// All routes registered under /orgs/:slug/projects in app.ts.
// requireOrgMember handles JWT verification + org lookup + membership check,
// and attaches req.org and req.membership before the handler runs.
// =============================================================================

export const projectsRoutes = async (app: FastifyInstance) => {

  // POST /orgs/:slug/projects — create a project
  app.post('/', {
    preHandler: [requireOrgMember],
    schema: {
      summary:     'Create project',
      description: 'Creates a new project inside the organization',
      tags:        ['Projects'],
      security:    [{ bearerAuth: [] }],
      response: {
        201: projectResponseSchema,
        400: errorSchema,
        409: errorSchema,
      },
    },
  }, async (req, reply) => {
    const parsed = createProjectSchema.safeParse(req.body)

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
      const project = await projectsService.createProject(parsed.data, req.org.id, req.user.userId)
      return reply.status(201).send(project)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'KEY_TAKEN') {
        return reply.status(409).send({
          error:   'KEY_TAKEN',
          message: `A project with key ${parsed.data.key.toUpperCase()} already exists in this org`,
        })
      }
      throw err
    }
  })


  // GET /orgs/:slug/projects — list active projects in the org
  app.get('/', {
    preHandler: [requireOrgMember],
    schema: {
      summary:     'List projects',
      description: 'Returns all active (non-archived) projects in the organization',
      tags:        ['Projects'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: { type: 'array' as const, items: projectResponseSchema },
      },
    },
  }, async (req, reply) => {
    const list = await projectsService.getOrgProjects(req.org.id)
    return reply.status(200).send(list)
  })


  // GET /orgs/:slug/projects/:projectId — get project with members
  app.get('/:projectId', {
    preHandler: [requireOrgMember],
    schema: {
      summary:     'Get project',
      description: 'Returns project details including the member list',
      tags:        ['Projects'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: projectDetailSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { slug: string; projectId: string }

    try {
      const project = await projectsService.getProjectDetail(projectId)
      return reply.status(200).send(project)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'PROJECT_NOT_FOUND') {
        return reply.status(404).send({ error: 'PROJECT_NOT_FOUND', message: 'Project not found' })
      }
      throw err
    }
  })


  // PATCH /orgs/:slug/projects/:projectId — update project (lead, owner, admin)
  app.patch('/:projectId', {
    preHandler: [requireOrgMember],
    schema: {
      summary:     'Update project',
      description: 'Updates project name, description, icon, color, or archived status',
      tags:        ['Projects'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: projectResponseSchema,
        400: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { slug: string; projectId: string }

    const allowed = await canManageProjectMembers(req.membership.role, projectId, req.user.userId)
    if (!allowed) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Only org owners, admins, or project leads can update a project' })
    }

    const parsed = updateProjectSchema.safeParse(req.body)

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
      const project = await projectsService.updateProject(projectId, parsed.data)
      return reply.status(200).send(project)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'PROJECT_NOT_FOUND') {
        return reply.status(404).send({ error: 'PROJECT_NOT_FOUND', message: 'Project not found' })
      }
      throw err
    }
  })


  // GET /orgs/:slug/projects/:projectId/members — list project members
  app.get('/:projectId/members', {
    preHandler: [requireOrgMember],
    schema: {
      summary:     'Get project members',
      description: 'Returns all members of the project',
      tags:        ['Projects'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: { type: 'array' as const, items: projectMemberSchema },
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { slug: string; projectId: string }
    const members = await projectsService.getProjectMembers(projectId)
    return reply.status(200).send(members)
  })


  // POST /orgs/:slug/projects/:projectId/members — add a member (lead, owner, admin)
  app.post('/:projectId/members', {
    preHandler: [requireOrgMember],
    schema: {
      summary:     'Add project member',
      description: 'Adds an org member to the project — caller must be org owner/admin or project lead',
      tags:        ['Projects'],
      security:    [{ bearerAuth: [] }],
      response: {
        201: projectMemberSchema,
        400: errorSchema,
        403: errorSchema,
        409: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { slug: string; projectId: string }

    const allowed = await canManageProjectMembers(req.membership.role, projectId, req.user.userId)
    if (!allowed) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Only org owners, admins, or project leads can add members' })
    }

    const parsed = addProjectMemberSchema.safeParse(req.body)

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
      const member = await projectsService.addProjectMember(projectId, parsed.data, req.user.userId)
      return reply.status(201).send(member)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'ALREADY_PROJECT_MEMBER') {
        return reply.status(409).send({ error: 'ALREADY_PROJECT_MEMBER', message: 'User is already a member of this project' })
      }
      throw err
    }
  })


  // PATCH /orgs/:slug/projects/:projectId/members/:userId — update role (lead, owner, admin)
  app.patch('/:projectId/members/:userId', {
    preHandler: [requireOrgMember],
    schema: {
      summary:     'Update project member role',
      description: 'Changes a member\'s role — caller must be org owner/admin or project lead',
      tags:        ['Projects'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: messageSchema,
        400: errorSchema,
        403: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, userId } = req.params as { slug: string; projectId: string; userId: string }

    const allowed = await canManageProjectMembers(req.membership.role, projectId, req.user.userId)
    if (!allowed) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Only org owners, admins, or project leads can change member roles' })
    }

    const parsed = updateProjectMemberRoleSchema.safeParse(req.body)

    if (!parsed.success) {
      return reply.status(400).send({
        error:  'VALIDATION_ERROR',
        issues: parsed.error.issues.map((e: z.core.$ZodIssue) => ({
          field:   e.path.join('.'),
          message: e.message,
        })),
      })
    }

    await projectsService.updateProjectMemberRole(projectId, userId, parsed.data.role)
    return reply.status(200).send({ message: 'Member role updated' })
  })


  // DELETE /orgs/:slug/projects/:projectId/members/:userId — remove member (lead, owner, admin)
  app.delete('/:projectId/members/:userId', {
    preHandler: [requireOrgMember],
    schema: {
      summary:     'Remove project member',
      description: 'Removes a user from the project — caller must be org owner/admin or project lead',
      tags:        ['Projects'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: messageSchema,
        403: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { projectId, userId } = req.params as { slug: string; projectId: string; userId: string }

    const allowed = await canManageProjectMembers(req.membership.role, projectId, req.user.userId)
    if (!allowed) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Only org owners, admins, or project leads can remove members' })
    }

    await projectsService.removeProjectMember(projectId, userId)
    return reply.status(200).send({ message: 'Member removed from project' })
  })
}
