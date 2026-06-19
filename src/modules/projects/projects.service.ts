import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { projects, projectMembers, issueStatuses, issues, users } from '../../db/schema.js'
import type {
  CreateProjectInput,
  UpdateProjectInput,
  AddProjectMemberInput,
  ProjectResponse,
  ProjectWithStats,
  ProjectDetail,
  ProjectMember,
  ProjectStats,
} from './projects.types.js'

// =============================================================================
// CREATE PROJECT
// =============================================================================

export const createProject = async (
  input: CreateProjectInput,
  orgId: string,
  userId: string,
): Promise<ProjectResponse> => {
  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(
      eq(projects.orgId, orgId),
      eq(projects.key, input.key.toUpperCase()),
    ))
    .limit(1)

  if (existing.length > 0) throw new Error('KEY_TAKEN')

  const [project] = await db
    .insert(projects)
    .values({
      orgId,
      name:        input.name,
      key:         input.key.toUpperCase(),
      description: input.description ?? null,
      icon:        input.icon ?? null,
      color:       input.color ?? null,
      createdBy:   userId,
    })
    .returning()

  if (!project) throw new Error('PROJECT_CREATION_FAILED')

  await db.insert(projectMembers).values({
    projectId: project.id,
    userId,
    role:      'lead',
    addedBy:   userId,
  })

  await db.insert(issueStatuses).values([
    { projectId: project.id, name: 'Todo',        color: '#6b7280', position: 1, isDefault: true,  category: 'todo'        },
    { projectId: project.id, name: 'In Progress', color: '#3b82f6', position: 2, isDefault: false, category: 'in_progress' },
    { projectId: project.id, name: 'In Review',   color: '#f59e0b', position: 3, isDefault: false, category: 'in_progress' },
    { projectId: project.id, name: 'Done',        color: '#10b981', position: 4, isDefault: false, category: 'done'        },
    { projectId: project.id, name: 'Cancelled',   color: '#ef4444', position: 5, isDefault: false, category: 'done'        },
  ])

  return toResponse(project)
}

// =============================================================================
// GET PROJECT BY ID
// =============================================================================

export const getProjectById = async (
  projectId: string,
): Promise<ProjectResponse> => {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) throw new Error('PROJECT_NOT_FOUND')

  return toResponse(project)
}

// =============================================================================
// GET PROJECT WITH MEMBERS
// =============================================================================

export const getProjectDetail = async (
  projectId: string,
): Promise<ProjectDetail> => {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) throw new Error('PROJECT_NOT_FOUND')

  const members = await getProjectMembers(projectId)

  return { ...toResponse(project), members }
}

// =============================================================================
// GET ORG PROJECTS
// =============================================================================

export const getOrgProjects = async (
  orgId:    string,
  userId:   string,
  userRole: string,
): Promise<ProjectWithStats[]> => {
  let projectRows: (typeof projects.$inferSelect)[]

  if (userRole === 'owner' || userRole === 'admin') {
    projectRows = await db
      .select()
      .from(projects)
      .where(and(
        eq(projects.orgId, orgId),
        eq(projects.isArchived, false),
      ))
  } else {
    const rows = await db
      .select({ project: projects })
      .from(projects)
      .innerJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, projects.id),
          eq(projectMembers.userId, userId),
        ),
      )
      .where(and(
        eq(projects.orgId, orgId),
        eq(projects.isArchived, false),
      ))
    projectRows = rows.map(r => r.project)
  }

  if (projectRows.length === 0) return []

  const statsMap = await getProjectStatsMap(projectRows.map(p => p.id))

  return projectRows.map(p => ({
    ...toResponse(p),
    stats: statsMap.get(p.id) ?? { todo: 0, inProgress: 0, done: 0, total: 0 },
  }))
}

// =============================================================================
// PROJECT STATS — aggregated issue counts by status category
// =============================================================================

const getProjectStatsMap = async (
  projectIds: string[],
): Promise<Map<string, ProjectStats>> => {
  const rows = await db
    .select({
      projectId: issues.projectId,
      category:  issueStatuses.category,
      count:     sql<number>`count(*)::int`,
    })
    .from(issues)
    .innerJoin(issueStatuses, eq(issues.statusId, issueStatuses.id))
    .where(inArray(issues.projectId, projectIds))
    .groupBy(issues.projectId, issueStatuses.category)

  const map = new Map<string, ProjectStats>()

  for (const row of rows) {
    let stats = map.get(row.projectId)
    if (!stats) {
      stats = { todo: 0, inProgress: 0, done: 0, total: 0 }
      map.set(row.projectId, stats)
    }

    const count = row.count
    stats.total += count

    if (row.category === 'todo')        stats.todo       += count
    else if (row.category === 'in_progress') stats.inProgress += count
    else if (row.category === 'done')   stats.done       += count
  }

  return map
}

// =============================================================================
// BOT — LIST ALL PROJECTS (no auth filtering)
// =============================================================================

export const getAllProjectsByOrg = async (orgId: string): Promise<ProjectResponse[]> => {
  const rows = await db
    .select()
    .from(projects)
    .where(and(
      eq(projects.orgId, orgId),
      eq(projects.isArchived, false),
    ))
  return rows.map(toResponse)
}

// =============================================================================
// GET PROJECT MEMBERS
// =============================================================================

export const getProjectMembers = async (projectId: string): Promise<ProjectMember[]> => {
  const rows = await db
    .select({
      id:        projectMembers.id,
      userId:    projectMembers.userId,
      name:      users.name,
      email:     users.email,
      avatarUrl: users.avatarUrl,
      role:      projectMembers.role,
      addedAt:   projectMembers.addedAt,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId))

  return rows.map(r => ({
    id:        r.id,
    userId:    r.userId,
    name:      r.name,
    email:     r.email,
    avatarUrl: r.avatarUrl ?? null,
    role:      r.role,
    addedAt:   r.addedAt.toISOString(),
  }))
}

// =============================================================================
// UPDATE PROJECT
// =============================================================================

export const updateProject = async (
  projectId: string,
  input: UpdateProjectInput,
): Promise<ProjectResponse> => {
  const [project] = await db
    .update(projects)
    .set({
      ...(input.name             !== undefined && { name:             input.name }),
      ...(input.description      !== undefined && { description:      input.description }),
      ...(input.icon             !== undefined && { icon:             input.icon }),
      ...(input.color            !== undefined && { color:            input.color }),
      ...(input.isArchived       !== undefined && { isArchived:       input.isArchived }),
      ...(input.weeklyAutoCreate !== undefined && { weeklyAutoCreate: input.weeklyAutoCreate }),
    })
    .where(eq(projects.id, projectId))
    .returning()

  if (!project) throw new Error('PROJECT_NOT_FOUND')

  return toResponse(project)
}

// =============================================================================
// ADD PROJECT MEMBER
// =============================================================================

export const addProjectMember = async (
  projectId: string,
  input: AddProjectMemberInput,
  addedBy: string,
): Promise<ProjectMember> => {
  const [existing] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, input.userId),
    ))
    .limit(1)

  if (existing) throw new Error('ALREADY_PROJECT_MEMBER')

  const [membership] = await db
    .insert(projectMembers)
    .values({
      projectId,
      userId:  input.userId,
      role:    input.role,
      addedBy,
    })
    .returning()

  if (!membership) throw new Error('ADD_MEMBER_FAILED')

  const [user] = await db
    .select({ name: users.name, email: users.email, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1)

  if (!user) throw new Error('USER_NOT_FOUND')

  return {
    id:        membership.id,
    userId:    membership.userId,
    name:      user.name,
    email:     user.email,
    avatarUrl: user.avatarUrl ?? null,
    role:      membership.role,
    addedAt:   membership.addedAt.toISOString(),
  }
}

// =============================================================================
// UPDATE PROJECT MEMBER ROLE
// =============================================================================

export const updateProjectMemberRole = async (
  projectId: string,
  userId: string,
  role: 'lead' | 'member' | 'viewer',
): Promise<void> => {
  await db
    .update(projectMembers)
    .set({ role })
    .where(and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, userId),
    ))
}

// =============================================================================
// REMOVE PROJECT MEMBER
// =============================================================================

export const removeProjectMember = async (
  projectId: string,
  userId: string,
): Promise<void> => {
  await db
    .delete(projectMembers)
    .where(and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, userId),
    ))
}

// =============================================================================
// GET PROJECT MEMBER ROLE
// =============================================================================

export const getProjectMemberRole = async (
  projectId: string,
  userId: string,
): Promise<'lead' | 'member' | 'viewer' | null> => {
  const [row] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, userId),
    ))
    .limit(1)

  return row?.role ?? null
}

// =============================================================================
// HELPERS
// =============================================================================

const toResponse = (p: typeof projects.$inferSelect): ProjectResponse => ({
  id:               p.id,
  orgId:            p.orgId,
  name:             p.name,
  key:              p.key,
  description:      p.description ?? null,
  icon:             p.icon ?? null,
  color:            p.color ?? null,
  isArchived:       p.isArchived,
  createdBy:        p.createdBy,
  createdAt:        p.createdAt.toISOString(),
  weeklyAutoCreate: p.weeklyAutoCreate,
})
