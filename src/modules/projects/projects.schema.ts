import { z } from 'zod'

export const createProjectSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(255),
  key: z.string()
    .min(2, 'Key must be at least 2 characters')
    .max(10, 'Key must be at most 10 characters')
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Key must be uppercase letters and numbers, starting with a letter'),
  description: z.string().max(1000).optional(),
  icon:        z.string().max(10).optional(),
  color:       z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex code e.g. #6366f1').optional(),
})

export const updateProjectSchema = z.object({
  name:               z.string().min(2).max(255).optional(),
  description:        z.string().max(1000).optional(),
  icon:               z.string().max(10).optional(),
  color:              z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex code').optional(),
  isArchived:         z.boolean().optional(),
  cadenceType:        z.enum(['none', 'weekly', 'biweekly', 'monthly']).optional(),
  cadenceStartDay:    z.number().int().min(0).max(6).nullable().optional(),
  cadenceDuration:    z.number().int().positive().nullable().optional(),
  cadenceAutoCreate:  z.boolean().optional(),
  cadenceNaming:      z.string().max(100).nullable().optional(),
})

export const addProjectMemberSchema = z.object({
  userId: z.uuid('Invalid user ID'),
  role:   z.enum(['lead', 'member', 'viewer'], {
    error: 'Role must be one of: lead, member, viewer',
  }),
})

export const updateProjectMemberRoleSchema = z.object({
  role: z.enum(['lead', 'member', 'viewer'], {
    error: 'Role must be one of: lead, member, viewer',
  }),
})

export const projectParamsSchema = z.object({
  projectId: z.uuid('Invalid project ID'),
})

export type CreateProjectInput           = z.infer<typeof createProjectSchema>
export type UpdateProjectInput           = z.infer<typeof updateProjectSchema>
export type AddProjectMemberInput        = z.infer<typeof addProjectMemberSchema>
export type UpdateProjectMemberRoleInput = z.infer<typeof updateProjectMemberRoleSchema>
