import { and, eq, isNull, asc, desc } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { issues, projects, issueStatuses, users, issueHistory } from '../../db/schema.js'
import { emitGraphEvent } from '../../utils/graphEvents.js'
import type {
  CreateIssueInput,
  UpdateIssueInput,
  UpdateIssueStatusInput,
  IssueResponse,
  IssueDetail,
  IssueListItem,
  IssueHistoryEntry,
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

  const response = toResponse(result)
  // Keep the graph in step with this direct REST write (best-effort, non-blocking).
  emitGraphEvent('issue', response)
  return response
}

// =============================================================================
// GET ISSUES BY PROJECT
// =============================================================================

export const getIssuesByProject = async (
  projectId: string,
  options?: { limit?: number; offset?: number },
): Promise<IssueResponse[]> => {
  const limit = options?.limit ?? 100
  const offset = options?.offset ?? 0

  const rows = await db
    .select()
    .from(issues)
    .where(and(
      eq(issues.projectId, projectId),
      isNull(issues.deletedAt),
    ))
    .orderBy(asc(issues.number))
    .limit(limit)
    .offset(offset)

  return rows.map(toResponse)
}

// =============================================================================
// GET ISSUES BY PROJECT — WITH RELATIONS (status + assignee resolved)
// =============================================================================

// Like getIssuesByProject, but resolves each issue's status and assignee to
// their full objects (names, not raw IDs) in a single joined query. Used by the
// bot/AI list endpoint, which needs human-readable assignee + status to answer
// questions like "who is assigned to what". The plain getIssuesByProject stays
// ID-only for the frontend board (it resolves members client-side), so its
// callers are unaffected.
export const getIssuesByProjectWithRelations = async (
  projectId: string,
  options?: { limit?: number; offset?: number },
): Promise<IssueListItem[]> => {
  const limit = options?.limit ?? 100
  const offset = options?.offset ?? 0

  const rows = await db
    .select({
      issue:    issues,
      status:   issueStatuses,
      assignee: users,
    })
    .from(issues)
    .innerJoin(issueStatuses, eq(issues.statusId, issueStatuses.id))
    .leftJoin(users, eq(issues.assigneeId, users.id))
    .where(and(
      eq(issues.projectId, projectId),
      isNull(issues.deletedAt),
    ))
    .orderBy(asc(issues.number))
    .limit(limit)
    .offset(offset)

  return rows.map((row) => ({
    ...toResponse(row.issue),
    status: {
      id:       row.status.id,
      name:     row.status.name,
      color:    row.status.color,
      position: row.status.position,
      category: row.status.category,
    },
    assignee: row.assignee
      ? { id: row.assignee.id, name: row.assignee.name, email: row.assignee.email, avatarUrl: row.assignee.avatarUrl ?? null }
      : null,
  }))
}

// =============================================================================
// GET ISSUE BY ID
// =============================================================================

export const getIssueById = async (projectId: string, issueId: string): Promise<IssueDetail> => {
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
      eq(issues.projectId, projectId),
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
      category: row.status.category,
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

// Maps UpdateIssueInput keys → DB column names (for history recording)
const HISTORY_FIELD_MAP: Record<
  string,
  { dbCol: string; getCurrent: (i: typeof issues.$inferSelect) => string | null }
> = {
  title:          { dbCol: 'title',           getCurrent: (i) => i.title },
  description:    { dbCol: 'description',     getCurrent: (i) => i.description ?? null },
  type:           { dbCol: 'type',            getCurrent: (i) => i.type },
  statusId:       { dbCol: 'status_id',       getCurrent: (i) => i.statusId },
  priority:       { dbCol: 'priority',        getCurrent: (i) => i.priority },
  assigneeId:     { dbCol: 'assignee_id',     getCurrent: (i) => i.assigneeId ?? null },
  parentId:       { dbCol: 'parent_id',       getCurrent: (i) => i.parentId ?? null },
  storyPoints:    { dbCol: 'story_points',    getCurrent: (i) => i.storyPoints !== null ? String(i.storyPoints) : null },
  estimatedHours: { dbCol: 'estimated_hours', getCurrent: (i) => i.estimatedHours !== null ? String(i.estimatedHours) : null },
  actualHours:    { dbCol: 'actual_hours',    getCurrent: (i) => i.actualHours !== null ? String(i.actualHours) : null },
  dueDate:        { dbCol: 'due_date',        getCurrent: (i) => i.dueDate?.toISOString() ?? null },
}

export const updateIssue = async (
  projectId: string,
  issueId:   string,
  input:     UpdateIssueInput,
  changedBy: string,
): Promise<IssueResponse> => {
  const [current] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.projectId, projectId), isNull(issues.deletedAt)))
    .limit(1)

  if (!current) throw new Error('ISSUE_NOT_FOUND')

  // When the status changes, derive startedAt/completedAt from the new status's category.
  const statusTs =
    input.statusId !== undefined && input.statusId !== current.statusId
      ? await computeStatusTimestamps(projectId, input.statusId, current)
      : null

  const [issue] = await db
    .update(issues)
    .set({
      ...(input.title          !== undefined && { title: input.title }),
      ...(input.description    !== undefined && { description: input.description }),
      ...(input.type           !== undefined && { type: input.type }),
      ...(input.statusId       !== undefined && { statusId: input.statusId }),
      ...(statusTs !== null && { startedAt: statusTs.startedAt, completedAt: statusTs.completedAt }),
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
      eq(issues.projectId, projectId),
      isNull(issues.deletedAt),
    ))
    .returning()

  if (!issue) throw new Error('ISSUE_NOT_FOUND')

  // Write one history row per changed field
  const historyRows = Object.entries(HISTORY_FIELD_MAP)
    .filter(([key]) => key in input)
    .map(([key, { dbCol, getCurrent }]) => {
      const rawNew = input[key as keyof UpdateIssueInput]
      return {
        issueId,
        changedBy,
        fieldChanged: dbCol,
        oldValue:     getCurrent(current),
        newValue:     rawNew === null || rawNew === undefined ? null : String(rawNew),
      }
    })

  if (historyRows.length > 0) {
    await db.insert(issueHistory).values(historyRows)
  }

  const response = toResponse(issue)
  emitGraphEvent('issue', response)
  return response
}

// =============================================================================
// UPDATE ISSUE STATUS  (board drag-and-drop)
// =============================================================================

export const updateIssueStatus = async (
  projectId: string,
  issueId:   string,
  input:     UpdateIssueStatusInput,
  changedBy: string,
): Promise<IssueResponse> => {
  const [current] = await db
    .select({ statusId: issues.statusId, startedAt: issues.startedAt, completedAt: issues.completedAt })
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.projectId, projectId), isNull(issues.deletedAt)))
    .limit(1)

  if (!current) throw new Error('ISSUE_NOT_FOUND')

  const { startedAt, completedAt } = await computeStatusTimestamps(projectId, input.statusId, current)

  const [issue] = await db
    .update(issues)
    .set({ statusId: input.statusId, startedAt, completedAt })
    .where(and(
      eq(issues.id, issueId),
      eq(issues.projectId, projectId),
      isNull(issues.deletedAt),
    ))
    .returning()

  if (!issue) throw new Error('ISSUE_NOT_FOUND')

  await db.insert(issueHistory).values({
    issueId,
    changedBy,
    fieldChanged: 'status_id',
    oldValue:     current.statusId,
    newValue:     input.statusId,
  })

  const response = toResponse(issue)
  emitGraphEvent('issue', response)
  return response
}

// =============================================================================
// DELETE ISSUE  (soft delete)
// =============================================================================

export const deleteIssue = async (projectId: string, issueId: string): Promise<void> => {
  const [issue] = await db
    .update(issues)
    .set({ deletedAt: new Date() })
    .where(and(
      eq(issues.id, issueId),
      eq(issues.projectId, projectId),
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
// GET ISSUE HISTORY
// =============================================================================

export const getIssueHistory = async (projectId: string, issueId: string): Promise<IssueHistoryEntry[]> => {
  const [exists] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.projectId, projectId)))
    .limit(1)
  if (!exists) throw new Error('ISSUE_NOT_FOUND')

  const rows = await db
    .select({
      history: issueHistory,
      changer: users,
    })
    .from(issueHistory)
    .innerJoin(users, eq(issueHistory.changedBy, users.id))
    .where(eq(issueHistory.issueId, issueId))
    .orderBy(desc(issueHistory.changedAt))

  return rows.map((row) => ({
    id:           row.history.id,
    issueId:      row.history.issueId,
    fieldChanged: row.history.fieldChanged,
    oldValue:     row.history.oldValue ?? null,
    newValue:     row.history.newValue ?? null,
    changedAt:    row.history.changedAt.toISOString(),
    changedBy: {
      id:        row.changer.id,
      name:      row.changer.name,
      avatarUrl: row.changer.avatarUrl ?? null,
    },
  }))
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Derives startedAt/completedAt for an issue moving to `newStatusId`, based on
 * the target status's workflow category:
 *   - in_progress / done → stamp startedAt once (if not already set)
 *   - done               → stamp completedAt (kept if already done)
 *   - todo / in_progress → clear completedAt (issue reopened)
 * Throws STATUS_NOT_FOUND if the status does not belong to the project.
 */
async function computeStatusTimestamps(
  projectId:   string,
  newStatusId: string,
  current:     { startedAt: Date | null; completedAt: Date | null },
): Promise<{ startedAt: Date | null; completedAt: Date | null }> {
  const [status] = await db
    .select({ category: issueStatuses.category })
    .from(issueStatuses)
    .where(and(eq(issueStatuses.id, newStatusId), eq(issueStatuses.projectId, projectId)))
    .limit(1)

  if (!status) throw new Error('STATUS_NOT_FOUND')

  const now = new Date()
  const startedAt =
    current.startedAt ??
    (status.category === 'in_progress' || status.category === 'done' ? now : null)
  const completedAt =
    status.category === 'done' ? (current.completedAt ?? now) : null

  return { startedAt, completedAt }
}

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
