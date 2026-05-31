import type { z } from 'zod'
import type { issueParamsSchema } from './issues.schema.js'

export type { CreateIssueInput, UpdateIssueInput, UpdateIssueStatusInput } from './issues.schema.js'

export type IssueParams = z.infer<typeof issueParamsSchema>

export interface IssueStatus {
  id:       string
  name:     string
  color:    string
  position: number
}

export interface IssueUser {
  id:        string
  name:      string
  email:     string
  avatarUrl: string | null
}

export interface IssueResponse {
  id:             string
  projectId:      string
  orgId:          string
  number:         number
  title:          string
  description:    string | null
  type:           string
  priority:       string
  statusId:       string
  assigneeId:     string | null
  reporterId:     string
  parentId:       string | null
  sprintId:       string | null
  storyPoints:    number | null
  estimatedHours: number | null
  actualHours:    number | null
  dueDate:        string | null
  startedAt:      string | null
  completedAt:    string | null
  createdAt:      string
  updatedAt:      string
}

export interface IssueDetail extends IssueResponse {
  status:   IssueStatus
  assignee: IssueUser | null
  reporter: IssueUser
}
