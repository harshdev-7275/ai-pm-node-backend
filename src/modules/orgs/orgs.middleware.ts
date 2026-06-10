import type { FastifyReply, FastifyRequest } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { organizations, organizationMembers } from '../../db/schema.js'

export async function requireOrgMember(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Step 1 — verify JWT (reuses the same jwtVerify the authenticate decorator calls)
  try {
    await req.jwtVerify()
  } catch {
    reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Token invalid or expired' })
    return
  }

  // Step 2 — find org by :slug param
  const { slug } = req.params as { slug: string }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1)

  if (!org) {
    reply.status(404).send({ error: 'ORG_NOT_FOUND', message: 'Organization not found' })
    return
  }

  // Step 3 — confirm the user is an active member
  const [membership] = await db
    .select({
      id:   organizationMembers.id,
      role: organizationMembers.role,
    })
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

  req.org        = org
  req.membership = membership
}
