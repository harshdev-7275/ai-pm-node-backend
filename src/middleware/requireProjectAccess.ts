import type { FastifyReply, FastifyRequest } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { organizations, organizationMembers, projects, projectMembers } from '../db/schema.js'
import { env } from '../config/env.js'
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
 *
 * The AI service may call via a valid X-Bot-Secret header; it acts at 'lead'
 * level (matching the previous requireBotOrMember behaviour) so internal
 * automation keeps working, but is still bound to a project inside the org.
 */
export function requireProjectAccess(minRole: AccessLevel) {
  return async function projectAccessGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { slug, projectId } = req.params as { slug: string; projectId: string }

    // --- Bot path: trusted service-to-service call ---------------------------
    const botSecret = req.headers['x-bot-secret']
    if (botSecret) {
      if (botSecret !== env.BOT_SECRET) {
        reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid bot secret' })
        return
      }

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
      req.isBot       = true
      req.botUserId   = req.headers['x-bot-user-id'] as string | undefined
      req.projectRole = 'lead'
      return
    }

    // --- User path -----------------------------------------------------------
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

    const [membership] = await db
      .select({ id: organizationMembers.id, role: organizationMembers.role })
      .from(organizationMembers)
      .where(and(
        eq(organizationMembers.orgId, org.id),
        eq(organizationMembers.userId, req.user.userId),
        eq(organizationMembers.isActive, true),
      ))
      .limit(1)

    if (!membership) {
      reply.status(403).send({ error: 'FORBIDDEN', message: 'You are not a member of this organization' })
      return
    }

    // Project must exist AND belong to this org (tenant isolation).
    if (!(await projectBelongsToOrg(projectId, org.id))) {
      reply.status(404).send({ error: 'PROJECT_NOT_FOUND', message: 'Project not found' })
      return
    }

    const [pm] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, req.user.userId),
      ))
      .limit(1)

    const access = resolveProjectAccess(membership.role, pm?.role ?? null)
    if (access === null || !meetsAccess(access, minRole)) {
      reply.status(403).send({ error: 'FORBIDDEN', message: `This action requires project ${minRole} access` })
      return
    }

    req.org         = org
    req.membership  = membership
    req.projectRole = access
    req.isBot       = false
    req.botUserId   = undefined
  }
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
