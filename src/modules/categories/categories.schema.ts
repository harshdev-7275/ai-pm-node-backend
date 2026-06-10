import { z } from 'zod'

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex code e.g. #6366f1')

export const createCategorySchema = z.object({
  name:        z.string().min(1).max(100),
  color:       hexColor.optional(),
  description: z.string().max(500).optional(),
})

export const updateCategorySchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  color:       hexColor.optional(),
  description: z.string().max(500).nullable().optional(),
})

export const assignSprintSchema = z.object({
  sprintId: z.string().uuid('Invalid sprint ID'),
})

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>
