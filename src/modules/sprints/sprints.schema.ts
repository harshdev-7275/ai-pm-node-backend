import { z } from 'zod'

export const createSprintSchema = z.object({
  name:      z.string().min(1, 'Name is required').max(255),
  goal:      z.string().max(1000).optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate:   z.string().datetime({ offset: true }).optional(),
})

export const updateSprintSchema = z.object({
  name:      z.string().min(1).max(255).optional(),
  goal:      z.string().max(1000).nullable().optional(),
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  endDate:   z.string().datetime({ offset: true }).nullable().optional(),
})

export const sprintParamsSchema = z.object({
  sprintId: z.uuid('Invalid sprint ID'),
})

export const sprintIssueParamsSchema = z.object({
  sprintId: z.uuid('Invalid sprint ID'),
  issueId:  z.uuid('Invalid issue ID'),
})

export type CreateSprintInput = z.infer<typeof createSprintSchema>
export type UpdateSprintInput = z.infer<typeof updateSprintSchema>
