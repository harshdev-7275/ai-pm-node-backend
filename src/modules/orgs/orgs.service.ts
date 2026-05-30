import crypto from 'crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { organizations, organizationMembers, invitations, users } from '../../db/schema.js'
import type {
  CreateOrgInput,
  UpdateOrgInput,
  InviteMemberInput,
  OrgResponse,
  OrgDetail,
  OrgMember,
  InvitationResult,
} from './orgs.types.js'

// =============================================================================
// CREATE ORG
// =============================================================================

export const createOrg = async (
  input: CreateOrgInput,
  userId: string,
): Promise<OrgResponse> => {
  const slug = await resolveSlug(input.slug ?? generateSlug(input.name))

  const [org] = await db
    .insert(organizations)
    .values({ name: input.name, slug })
    .returning()

  if (!org) throw new Error('ORG_CREATION_FAILED')

  await db.insert(organizationMembers).values({
    orgId:  org.id,
    userId,
    role:   'owner',
  })

  return toResponse(org)
}

// =============================================================================
// GET ORG BY SLUG
// =============================================================================

export const getOrgBySlug = async (
  slug: string,
  userId: string,
): Promise<OrgDetail> => {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1)

  if (!org) throw new Error('ORG_NOT_FOUND')

  const [membership] = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(
      eq(organizationMembers.orgId, org.id),
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.isActive, true),
    ))
    .limit(1)

  if (!membership) throw new Error('NOT_MEMBER')

  const members = await getOrgMembers(org.id)

  return { ...toResponse(org), members }
}

// =============================================================================
// GET ORG MEMBERS
// =============================================================================

export const getOrgMembers = async (orgId: string): Promise<OrgMember[]> => {
  const rows = await db
    .select({
      id:        organizationMembers.id,
      userId:    organizationMembers.userId,
      name:      users.name,
      email:     users.email,
      avatarUrl: users.avatarUrl,
      role:      organizationMembers.role,
      joinedAt:  organizationMembers.joinedAt,
      isActive:  organizationMembers.isActive,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(and(
      eq(organizationMembers.orgId, orgId),
      eq(organizationMembers.isActive, true),
    ))

  return rows.map(r => ({
    id:        r.id,
    userId:    r.userId,
    name:      r.name,
    email:     r.email,
    avatarUrl: r.avatarUrl ?? null,
    role:      r.role,
    joinedAt:  r.joinedAt.toISOString(),
    isActive:  r.isActive,
  }))
}

// =============================================================================
// GET USER ORGS
// =============================================================================

export const getUserOrgs = async (userId: string): Promise<OrgResponse[]> => {
  const rows = await db
    .select({
      id:        organizations.id,
      name:      organizations.name,
      slug:      organizations.slug,
      logoUrl:   organizations.logoUrl,
      plan:      organizations.plan,
      isActive:  organizations.isActive,
      createdAt: organizations.createdAt,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.orgId, organizations.id))
    .where(and(
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.isActive, true),
    ))

  return rows.map(r => ({
    id:        r.id,
    name:      r.name,
    slug:      r.slug,
    logoUrl:   r.logoUrl ?? null,
    plan:      r.plan,
    isActive:  r.isActive,
    createdAt: r.createdAt.toISOString(),
  }))
}

// =============================================================================
// INVITE MEMBER
// =============================================================================

export const inviteMember = async (
  input: InviteMemberInput,
  orgId: string,
  invitedBy: string,
): Promise<InvitationResult> => {
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email.toLowerCase()))
    .limit(1)

  if (existingUser[0]) {
    const [activeMembership] = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(and(
        eq(organizationMembers.orgId, orgId),
        eq(organizationMembers.userId, existingUser[0].id),
        eq(organizationMembers.isActive, true),
      ))
      .limit(1)

    if (activeMembership) throw new Error('ALREADY_MEMBER')
  }

  const token     = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  const [invitation] = await db
    .insert(invitations)
    .values({
      orgId,
      email:     input.email.toLowerCase(),
      role:      input.role,
      invitedBy,
      token,
      expiresAt,
    })
    .returning()

  if (!invitation) throw new Error('INVITE_FAILED')

  return {
    id:        invitation.id,
    email:     invitation.email,
    role:      invitation.role,
    token:     invitation.token,
    expiresAt: invitation.expiresAt.toISOString(),
    invitedBy: invitation.invitedBy,
  }
}

// =============================================================================
// ACCEPT INVITE
// =============================================================================

export const acceptInvite = async (
  token: string,
  userId: string,
): Promise<OrgResponse> => {
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.token, token))
    .limit(1)

  if (!invitation)              throw new Error('INVALID_INVITE_TOKEN')
  if (invitation.acceptedAt)   throw new Error('INVITE_ALREADY_USED')
  if (invitation.expiresAt < new Date()) throw new Error('INVITE_EXPIRED')

  await db
    .update(invitations)
    .set({ acceptedAt: new Date() })
    .where(eq(invitations.id, invitation.id))

  await db.insert(organizationMembers).values({
    orgId:     invitation.orgId,
    userId,
    role:      invitation.role,
    invitedBy: invitation.invitedBy,
  })

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, invitation.orgId))
    .limit(1)

  if (!org) throw new Error('ORG_NOT_FOUND')

  return toResponse(org)
}

// =============================================================================
// UPDATE MEMBER ROLE
// =============================================================================

export const updateMemberRole = async (
  orgId: string,
  targetUserId: string,
  newRole: 'admin' | 'member' | 'viewer',
  requestingUserId: string,
): Promise<void> => {
  if (requestingUserId === targetUserId) {
    throw new Error('CANNOT_CHANGE_OWN_ROLE')
  }

  await assertRole(orgId, requestingUserId, ['owner'])

  await db
    .update(organizationMembers)
    .set({ role: newRole })
    .where(and(
      eq(organizationMembers.orgId, orgId),
      eq(organizationMembers.userId, targetUserId),
      eq(organizationMembers.isActive, true),
    ))
}

// =============================================================================
// REMOVE MEMBER
// =============================================================================

export const removeMember = async (
  orgId: string,
  targetUserId: string,
  requestingUserId: string,
): Promise<void> => {
  if (requestingUserId === targetUserId) {
    throw new Error('CANNOT_REMOVE_SELF')
  }

  await assertRole(orgId, requestingUserId, ['owner', 'admin'])

  await db
    .update(organizationMembers)
    .set({ isActive: false })
    .where(and(
      eq(organizationMembers.orgId, orgId),
      eq(organizationMembers.userId, targetUserId),
      eq(organizationMembers.isActive, true),
    ))
}

// =============================================================================
// UPDATE ORG
// =============================================================================

export const updateOrg = async (
  orgId: string,
  input: UpdateOrgInput,
): Promise<OrgResponse> => {
  const [org] = await db
    .update(organizations)
    .set({
      ...(input.name    !== undefined && { name: input.name }),
      ...(input.logoUrl !== undefined && { logoUrl: input.logoUrl }),
    })
    .where(eq(organizations.id, orgId))
    .returning()

  if (!org) throw new Error('ORG_NOT_FOUND')

  return toResponse(org)
}

// =============================================================================
// HELPERS
// =============================================================================

const generateSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')

const resolveSlug = async (base: string): Promise<string> => {
  const [existing] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, base))
    .limit(1)

  if (!existing) return base

  const suffix = Math.floor(1000 + Math.random() * 9000)
  return `${base}-${suffix}`
}

const assertRole = async (
  orgId: string,
  userId: string,
  allowed: Array<'owner' | 'admin' | 'member' | 'viewer'>,
): Promise<void> => {
  const [membership] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(
      eq(organizationMembers.orgId, orgId),
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.isActive, true),
    ))
    .limit(1)

  if (!membership || !allowed.includes(membership.role)) {
    throw new Error('FORBIDDEN')
  }
}

const toResponse = (org: typeof organizations.$inferSelect): OrgResponse => ({
  id:        org.id,
  name:      org.name,
  slug:      org.slug,
  logoUrl:   org.logoUrl ?? null,
  plan:      org.plan,
  isActive:  org.isActive,
  createdAt: org.createdAt.toISOString(),
})
