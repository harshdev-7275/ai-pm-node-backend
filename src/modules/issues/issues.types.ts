import type { z } from 'zod'
import type { issueParamsSchema, commentParamsSchema } from './issues.schema.js'

export type {
  CreateIssueInput,
  UpdateIssueInput,
  UpdateIssueStatusInput,
  CreateCommentInput,
  UpdateCommentInput,
  CreateStatusInput,
  UpdateStatusInput,
} from './issues.schema.js'

export type IssueParams   = z.infer<typeof issueParamsSchema>
export type CommentParams = z.infer<typeof commentParamsSchema>

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

export interface CommentAuthor {
  id:        string
  name:      string
  avatarUrl: string | null
}

export interface CommentResponse {
  id:        string
  issueId:   string
  body:      string
  isEdited:  boolean
  parentId:  string | null
  author:    CommentAuthor
  createdAt: string
  updatedAt: string
}

export interface StatusResponse {
  id:        string
  projectId: string
  name:      string
  color:     string
  position:  number
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface IssueHistoryEntry {
  id:           string
  issueId:      string
  fieldChanged: string
  oldValue:     string | null
  newValue:     string | null
  changedAt:    string
  changedBy: {
    id:        string
    name:      string
    avatarUrl: string | null
  }
}
