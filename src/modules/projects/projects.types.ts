import type { z } from 'zod'
import type { projectParamsSchema } from './projects.schema.js'

export type {
  CreateProjectInput,
  UpdateProjectInput,
  AddProjectMemberInput,
  UpdateProjectMemberRoleInput,
} from './projects.schema.js'

export type ProjectParams = z.infer<typeof projectParamsSchema>

export interface ProjectMember {
  id:        string
  userId:    string
  name:      string
  email:     string
  avatarUrl: string | null
  role:      string
  addedAt:   string
}

export interface ProjectResponse {
  id:                string
  orgId:             string
  name:              string
  key:               string
  description:       string | null
  icon:              string | null
  color:             string | null
  isArchived:        boolean
  createdBy:         string
  createdAt:         string
  cadenceType:       'none' | 'weekly' | 'biweekly' | 'monthly'
  cadenceStartDay:   number | null
  cadenceDuration:   number | null
  cadenceAutoCreate: boolean
  cadenceNaming:     string | null
}

export interface ProjectDetail extends ProjectResponse {
  members: ProjectMember[]
}
