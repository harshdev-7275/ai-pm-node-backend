import { z } from 'zod'

const issueType     = z.enum(['feature', 'bug', 'task', 'subtask'])
const issuePriority = z.enum(['critical', 'high', 'medium', 'low'])

export const createIssueSchema = z.object({
  title:          z.string().min(1, 'Title is required').max(500),
  description:    z.string().max(10000).optional(),
  type:           issueType.default('task'),
  categoryId:     z.string().uuid('Invalid category ID'),
  statusId:       z.uuid('Invalid status ID'),
  priority:       issuePriority.default('medium'),
  assigneeId:     z.uuid('Invalid assignee ID').optional(),
  parentId:       z.uuid('Invalid parent issue ID').optional(),
  storyPoints:    z.number().int().min(0).optional(),
  estimatedHours: z.number().int().min(0).optional(),
  dueDate:        z.string().datetime().optional(),
})

export const updateIssueSchema = z.object({
  title:          z.string().min(1).max(500).optional(),
  description:    z.string().max(10000).optional(),
  type:           issueType.optional(),
  categoryId:     z.string().uuid('Invalid category ID').optional(),
  statusId:       z.uuid('Invalid status ID').optional(),
  priority:       issuePriority.optional(),
  assigneeId:     z.uuid('Invalid assignee ID').nullable().optional(),
  parentId:       z.uuid('Invalid parent issue ID').nullable().optional(),
  storyPoints:    z.number().int().min(0).nullable().optional(),
  estimatedHours: z.number().int().min(0).nullable().optional(),
  actualHours:    z.number().int().min(0).nullable().optional(),
  dueDate:        z.string().datetime().nullable().optional(),
})

export const updateIssueStatusSchema = z.object({
  statusId: z.uuid('Invalid status ID'),
})

export const issueParamsSchema = z.object({
  issueId: z.uuid('Invalid issue ID'),
})

export const createCommentSchema = z.object({
  body:     z.string().min(1, 'Comment body is required').max(10000),
  parentId: z.uuid('Invalid parent comment ID').optional(),
})

export const updateCommentSchema = z.object({
  body: z.string().min(1, 'Comment body is required').max(10000),
})

export const commentParamsSchema = z.object({
  issueId:   z.uuid('Invalid issue ID'),
  commentId: z.uuid('Invalid comment ID'),
})

export type CreateIssueInput       = z.infer<typeof createIssueSchema>
export type UpdateIssueInput       = z.infer<typeof updateIssueSchema>
export type UpdateIssueStatusInput = z.infer<typeof updateIssueStatusSchema>
export type CreateCommentInput     = z.infer<typeof createCommentSchema>
export type UpdateCommentInput     = z.infer<typeof updateCommentSchema>

// =============================================================================
// STATUS MANAGEMENT SCHEMAS
// =============================================================================

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color e.g. #3b82f6')
const statusCategory = z.enum(['todo', 'in_progress', 'done'])

export const createStatusSchema = z.object({
  name:     z.string().min(1, 'Name is required').max(100),
  color:    hexColor,
  category: statusCategory.default('todo'),
})

export const updateStatusSchema = z.object({
  name:     z.string().min(1).max(100).optional(),
  color:    hexColor.optional(),
  position: z.number().int().positive().optional(),
  category: statusCategory.optional(),
})

export type CreateStatusInput = z.infer<typeof createStatusSchema>
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>
