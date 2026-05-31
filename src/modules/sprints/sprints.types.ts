import type { z } from 'zod'
import type { sprintParamsSchema, sprintIssueParamsSchema } from './sprints.schema.js'

export type {
  CreateSprintInput,
  UpdateSprintInput,
} from './sprints.schema.js'

export type SprintParams      = z.infer<typeof sprintParamsSchema>
export type SprintIssueParams = z.infer<typeof sprintIssueParamsSchema>

export type SprintStatus = 'planned' | 'active' | 'completed'

export interface SprintResponse {
  id:        string
  projectId: string
  orgId:     string
  name:      string
  goal:      string | null
  status:    SprintStatus
  startDate: string | null
  endDate:   string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface SprintIssue {
  id:          string
  number:      number
  title:       string
  type:        string
  priority:    string
  statusId:    string
  assigneeId:  string | null
  storyPoints: number | null
}

export interface SprintDetail extends SprintResponse {
  issues:      SprintIssue[]
  issueCount:  number
  pointsTotal: number
}
