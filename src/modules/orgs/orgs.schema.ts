import { z } from 'zod'

export const createOrgSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(255),
  slug: z.string()
    .min(3, 'Slug must be at least 3 characters')
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens')
    .optional(),
})

export const inviteMemberSchema = z.object({
  email: z.email('Invalid email address').max(255),
  role:  z.enum(['admin', 'member', 'viewer'], {
    error: 'Role must be one of: admin, member, viewer',
  }),
})

export const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member', 'viewer'], {
    error: 'Role must be one of: admin, member, viewer',
  }),
})

export const updateOrgSchema = z.object({
  name:    z.string().min(2).max(255).optional(),
  logoUrl: z.url('Invalid logo URL').max(500).optional(),
})

export const orgParamsSchema = z.object({
  orgId: z.uuid('Invalid org ID'),
})

export type CreateOrgInput       = z.infer<typeof createOrgSchema>
export type InviteMemberInput    = z.infer<typeof inviteMemberSchema>
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>
