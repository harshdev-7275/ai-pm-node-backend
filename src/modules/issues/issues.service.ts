import { and, eq, isNull, asc } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { issues, projects, issueStatuses, users } from '../../db/schema.js'
import type {
  CreateIssueInput,
  UpdateIssueInput,
  UpdateIssueStatusInput,
  IssueResponse,
  IssueDetail,
} from './issues.types.js'

// =============================================================================
// CREATE ISSUE
// =============================================================================

export const createIssue = async (
  input:      CreateIssueInput,
  projectId:  string,
  orgId:      string,
  reporterId: string,
): Promise<IssueResponse> => {
  // Transaction: read current counter, increment it, insert issue — all atomic
  const result = await db.transaction(async (tx) => {
    const [project] = await tx
      .select({ issueCounter: projects.issueCounter })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    if (!project) throw new Error('PROJECT_NOT_FOUND')

    const number = project.issueCounter + 1

    await tx
      .update(projects)
      .set({ issueCounter: number })
      .where(eq(projects.id, projectId))

    const [issue] = await tx
      .insert(issues)
      .values({
        projectId,
        orgId,
        number,
        title:          input.title,
        description:    input.description ?? null,
        type:           input.type,
        statusId:       input.statusId,
        priority:       input.priority,
        assigneeId:     input.assigneeId ?? null,
        reporterId,
        parentId:       input.parentId ?? null,
        storyPoints:    input.storyPoints ?? null,
        estimatedHours: input.estimatedHours ?? null,
        dueDate:        input.dueDate ? new Date(input.dueDate) : null,
      })
      .returning()

    if (!issue) throw new Error('ISSUE_CREATION_FAILED')
    return issue
  })

  return toResponse(result)
}

// =============================================================================
// GET ISSUES BY PROJECT
// =============================================================================

export const getIssuesByProject = async (projectId: string): Promise<IssueResponse[]> => {
  const rows = await db
    .select()
    .from(issues)
    .where(and(
      eq(issues.projectId, projectId),
      isNull(issues.deletedAt),
    ))
    .orderBy(asc(issues.number))

  return rows.map(toResponse)
}

// =============================================================================
// GET ISSUE BY ID
// =============================================================================

export const getIssueById = async (issueId: string): Promise<IssueDetail> => {
  const [row] = await db
    .select({
      issue:    issues,
      status:   issueStatuses,
      assignee: users,
    })
    .from(issues)
    .innerJoin(issueStatuses, eq(issues.statusId, issueStatuses.id))
    .leftJoin(users, eq(issues.assigneeId, users.id))
    .where(and(
      eq(issues.id, issueId),
      isNull(issues.deletedAt),
    ))
    .limit(1)

  if (!row) throw new Error('ISSUE_NOT_FOUND')

  // Fetch reporter separately (always present)
  const [reporterRow] = await db
    .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, row.issue.reporterId))
    .limit(1)

  if (!reporterRow) throw new Error('ISSUE_NOT_FOUND')

  return {
    ...toResponse(row.issue),
    status: {
      id:       row.status.id,
      name:     row.status.name,
      color:    row.status.color,
      position: row.status.position,
    },
    assignee: row.assignee
      ? { id: row.assignee.id, name: row.assignee.name, email: row.assignee.email, avatarUrl: row.assignee.avatarUrl ?? null }
      : null,
    reporter: {
      id:        reporterRow.id,
      name:      reporterRow.name,
      email:     reporterRow.email,
      avatarUrl: reporterRow.avatarUrl ?? null,
    },
  }
}

// =============================================================================
// UPDATE ISSUE
// =============================================================================

export const updateIssue = async (
  issueId: string,
  input:   UpdateIssueInput,
): Promise<IssueResponse> => {
  const [issue] = await db
    .update(issues)
    .set({
      ...(input.title          !== undefined && { title: input.title }),
      ...(input.description    !== undefined && { description: input.description }),
      ...(input.type           !== undefined && { type: input.type }),
      ...(input.statusId       !== undefined && { statusId: input.statusId }),
      ...(input.priority       !== undefined && { priority: input.priority }),
      ...(input.assigneeId     !== undefined && { assigneeId: input.assigneeId }),
      ...(input.parentId       !== undefined && { parentId: input.parentId }),
      ...(input.storyPoints    !== undefined && { storyPoints: input.storyPoints }),
      ...(input.estimatedHours !== undefined && { estimatedHours: input.estimatedHours }),
      ...(input.actualHours    !== undefined && { actualHours: input.actualHours }),
      ...(input.dueDate        !== undefined && { dueDate: input.dueDate ? new Date(input.dueDate) : null }),
    })
    .where(and(
      eq(issues.id, issueId),
      isNull(issues.deletedAt),
    ))
    .returning()

  if (!issue) throw new Error('ISSUE_NOT_FOUND')
  return toResponse(issue)
}

// =============================================================================
// UPDATE ISSUE STATUS  (board drag-and-drop)
// =============================================================================

export const updateIssueStatus = async (
  issueId: string,
  input:   UpdateIssueStatusInput,
): Promise<IssueResponse> => {
  const [issue] = await db
    .update(issues)
    .set({ statusId: input.statusId })
    .where(and(
      eq(issues.id, issueId),
      isNull(issues.deletedAt),
    ))
    .returning()

  if (!issue) throw new Error('ISSUE_NOT_FOUND')
  return toResponse(issue)
}

// =============================================================================
// DELETE ISSUE  (soft delete)
// =============================================================================

export const deleteIssue = async (issueId: string): Promise<void> => {
  const [issue] = await db
    .update(issues)
    .set({ deletedAt: new Date() })
    .where(and(
      eq(issues.id, issueId),
      isNull(issues.deletedAt),
    ))
    .returning({ id: issues.id })

  if (!issue) throw new Error('ISSUE_NOT_FOUND')
}

// =============================================================================
// GET ISSUE STATUSES FOR PROJECT
// =============================================================================

export const getIssueStatuses = async (projectId: string) => {
  return db
    .select()
    .from(issueStatuses)
    .where(eq(issueStatuses.projectId, projectId))
    .orderBy(asc(issueStatuses.position))
}

// =============================================================================
// HELPERS
// =============================================================================

const toResponse = (i: typeof issues.$inferSelect): IssueResponse => ({
  id:             i.id,
  projectId:      i.projectId,
  orgId:          i.orgId,
  number:         i.number,
  title:          i.title,
  description:    i.description ?? null,
  type:           i.type,
  priority:       i.priority,
  statusId:       i.statusId,
  assigneeId:     i.assigneeId ?? null,
  reporterId:     i.reporterId,
  parentId:       i.parentId ?? null,
  sprintId:       i.sprintId ?? null,
  storyPoints:    i.storyPoints ?? null,
  estimatedHours: i.estimatedHours ?? null,
  actualHours:    i.actualHours ?? null,
  dueDate:        i.dueDate?.toISOString() ?? null,
  startedAt:      i.startedAt?.toISOString() ?? null,
  completedAt:    i.completedAt?.toISOString() ?? null,
  createdAt:      i.createdAt.toISOString(),
  updatedAt:      i.updatedAt.toISOString(),
})
