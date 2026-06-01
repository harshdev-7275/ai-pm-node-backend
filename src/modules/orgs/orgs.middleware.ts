import type { FastifyReply, FastifyRequest } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { organizations, organizationMembers } from '../../db/schema.js'
import { env } from '../../config/env.js'

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
  req.isBot      = false
  req.botUserId  = undefined
}

// Accepts either a valid bot secret (AI service) OR a user JWT with org membership.
// Use on routes the AI service needs to call. User routes stay on requireOrgMember.
export async function requireBotOrMember(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const botSecret = req.headers['x-bot-secret']

  if (botSecret) {
    // Bot path — validate secret, look up org (service layer needs req.org.id), skip membership
    if (botSecret !== env.BOT_SECRET) {
      reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid bot secret' })
      return
    }

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

    req.org       = org
    req.isBot     = true
    req.botUserId = req.headers['x-bot-user-id'] as string | undefined
    return
  }

  // User path — full JWT + membership check
  return requireOrgMember(req, reply)
}
