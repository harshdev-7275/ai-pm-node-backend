import type { z } from 'zod'
import type {
  updateOrgSchema,
  orgParamsSchema,
} from './orgs.schema.js'

export type { CreateOrgInput, InviteMemberInput, UpdateMemberRoleInput } from './orgs.schema.js'

export type UpdateOrgInput = z.infer<typeof updateOrgSchema>
export type OrgParams      = z.infer<typeof orgParamsSchema>

export interface OrgResponse {
  id:        string
  name:      string
  slug:      string
  logoUrl:   string | null
  plan:      string
  isActive:  boolean
  createdAt: string
}

export interface OrgMember {
  id:        string
  userId:    string
  name:      string
  email:     string
  avatarUrl: string | null
  role:      string
  joinedAt:  string
  isActive:  boolean
}

export interface OrgDetail {
  id:        string
  name:      string
  slug:      string
  logoUrl:   string | null
  plan:      string
  isActive:  boolean
  createdAt: string
  members:   OrgMember[]
}

export interface InvitationResult {
  id:        string
  email:     string
  role:      string
  token:     string
  expiresAt: string
  invitedBy: string
}
