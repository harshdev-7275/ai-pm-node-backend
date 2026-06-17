import type { FastifyReply, FastifyRequest } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { organizations, organizationMembers, projects, projectMembers } from '../db/schema.js'
import { resolveProjectAccess, meetsAccess, type AccessLevel } from '../utils/permissions.js'

/**
 * PreHandler factory that gates a project-scoped route by effective project access.
 *
 * It performs, in order:
 *   1. JWT verification
 *   2. active org-membership check (org from :slug)
 *   3. project-belongs-to-org check (tenant isolation — closes cross-org access)
 *   4. effective-access resolution (org role + project role) vs `minRole`
 *
 * On success it attaches req.org, req.membership and req.projectRole.
 */
export function requireProjectAccess(minRole: AccessLevel) {
  return async function projectAccessGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { slug, projectId } = req.params as { slug: string; projectId: string }

    // Service-token requests bypass JWT verification and access checks.
    if (req.isServiceRequest) {
      const org = await loadOrg(slug)
      if (!org) {
        reply.status(404).send({ error: 'ORG_NOT_FOUND', message: 'Organization not found' })
        return
      }
      if (!(await projectBelongsToOrg(projectId, org.id))) {
        reply.status(404).send({ error: 'PROJECT_NOT_FOUND', message: 'Project not found' })
        return
      }
      req.org         = org
      req.membership  = { id: 'service', role: 'owner' }
      req.projectRole = 'lead'
      return
    }

    try {
      await req.jwtVerify()
    } catch {
      reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Token invalid or expired' })
      return
    }

    const org = await loadOrg(slug)
    if (!org) {
      reply.status(404).send({ error: 'ORG_NOT_FOUND', message: 'Organization not found' })
      return
    }

    // Project must exist AND belong to this org (tenant isolation).
    if (!(await projectBelongsToOrg(projectId, org.id))) {
      reply.status(404).send({ error: 'PROJECT_NOT_FOUND', message: 'Project not found' })
      return
    }

    const { membership, access } = await resolveEffectiveAccess(org.id, projectId, req.user.userId)
    if (!membership) {
      reply.status(403).send({ error: 'FORBIDDEN', message: 'You are not a member of this organization' })
      return
    }
    if (access === null || !meetsAccess(access, minRole)) {
      reply.status(403).send({ error: 'FORBIDDEN', message: `This action requires project ${minRole} access` })
      return
    }

    req.org         = org
    req.membership  = membership
    req.projectRole = access
  }
}

/**
 * Resolve a user's effective project access by combining their active org
 * membership with their explicit project membership. Shared by the bot and
 * user paths so both authorize identically.
 *
 * Returns the org-membership row (null when the user is not an active member of
 * the org) and the resolved access level (null when they are an org member but
 * have no access to this particular project).
 */
async function resolveEffectiveAccess(
  orgId: string,
  projectId: string,
  userId: string,
): Promise<{
  membership: Pick<typeof organizationMembers.$inferSelect, 'id' | 'role'> | null
  access: AccessLevel | null
}> {
  const [membership] = await db
    .select({ id: organizationMembers.id, role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(
      eq(organizationMembers.orgId, orgId),
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.isActive, true),
    ))
    .limit(1)

  if (!membership) return { membership: null, access: null }

  const [pm] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, userId),
    ))
    .limit(1)

  return { membership, access: resolveProjectAccess(membership.role, pm?.role ?? null) }
}

async function loadOrg(slug: string): Promise<typeof organizations.$inferSelect | null> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1)
  return org ?? null
}

async function projectBelongsToOrg(projectId: string, orgId: string): Promise<boolean> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .limit(1)
  return Boolean(project)
}
