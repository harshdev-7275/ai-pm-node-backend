/**
 * permissions.ts — pure role-resolution logic (no DB, no Fastify).
 *
 * The app has two role layers:
 *   - org role:     'owner' | 'admin' | 'member' | 'viewer'  (organization_members.role)
 *   - project role: 'lead'  | 'member' | 'viewer'            (project_members.role)
 *
 * Inside a project the project role is the source of truth, with two overrides:
 *   - org owner/admin are global super-admins   → always 'lead'
 *   - org viewer is a hard read-only account    → capped at 'viewer'
 *   - org member is governed by their project_members row
 *
 * A member/viewer with NO project_members row has no access to that project.
 * This keeps the model consistent with the project visibility filter in
 * projects.service.getOrgProjects (members/viewers only see projects they were
 * explicitly added to).
 */
import type { organizationMembers, projectMembers } from '../db/schema.js'

export type OrgRole     = (typeof organizationMembers.$inferSelect)['role']
export type ProjectRole = (typeof projectMembers.$inferSelect)['role']

/** Effective access level inside a single project, on the project-role scale. */
export type AccessLevel = ProjectRole

const ACCESS_RANK: Record<AccessLevel, number> = {
  viewer: 1,
  member: 2,
  lead:   3,
}

/**
 * Resolve a user's effective access level for one project by combining their
 * org role with their explicit project membership (null if they have none).
 * Returns null when the user has no access to the project at all.
 */
export function resolveProjectAccess(
  orgRole: OrgRole,
  projectRole: ProjectRole | null,
): AccessLevel | null {
  // Org owners and admins manage every project in the org.
  if (orgRole === 'owner' || orgRole === 'admin') return 'lead'

  // Org members and viewers must be explicitly added to the project.
  if (projectRole === null) return null

  // Org viewers stay read-only everywhere, even if added with a higher role.
  if (orgRole === 'viewer') return 'viewer'

  // Org members get exactly their project role.
  return projectRole
}

/** True if `level` meets or exceeds the required minimum access level. */
export function meetsAccess(level: AccessLevel | null, required: AccessLevel): boolean {
  if (level === null) return false
  return ACCESS_RANK[level] >= ACCESS_RANK[required]
}

/** Org-scoped capability: who may create new projects in the org. */
export function canCreateProject(orgRole: OrgRole): boolean {
  return orgRole === 'owner' || orgRole === 'admin'
}
