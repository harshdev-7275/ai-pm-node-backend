import { and, eq, isNull, asc, desc } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { issues, projects, issueStatuses, users, issueHistory, categories } from '../../db/schema.js'
import type {
  CreateIssueInput,
  UpdateIssueInput,
  UpdateIssueStatusInput,
  IssueResponse,
  IssueDetail,
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
  await validateParent(projectId, input.parentId ?? null, input.type)

  // Transaction: read current counter + category sprint, insert issue — all atomic
  const result = await db.transaction(async (tx) => {
    const [project] = await tx
      .select({ issueCounter: projects.issueCounter })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    if (!project) throw new Error('PROJECT_NOT_FOUND')

    // Inherit sprintId from the category (if it's assigned to a sprint)
    const [category] = await tx
      .select({ sprintId: categories.sprintId })
      .from(categories)
      .where(eq(categories.id, input.categoryId))
      .limit(1)

    if (!category) throw new Error('CATEGORY_NOT_FOUND')

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
        categoryId:     input.categoryId,
        statusId:       input.statusId,
        priority:       input.priority,
        assigneeId:     input.assigneeId ?? null,
        reporterId,
        parentId:       input.parentId ?? null,
        sprintId:       category.sprintId ?? null,
        storyPoints:    input.storyPoints ?? null,
        estimatedHours: input.estimatedHours ?? null,
        dueDate:        input.dueDate ? new Date(input.dueDate) : null,
      })
      .returning()

    if (!issue) throw new Error('ISSUE_CREATION_FAILED')
    return issue
  })

  const response = toResponse(result)
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
  categoryId:     { dbCol: 'category_id',     getCurrent: (i) => i.categoryId },
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

  // Re-validate the subtask hierarchy whenever parentId or type is touched —
  // the effective (post-update) combination must still satisfy the rules.
  if (input.parentId !== undefined || input.type !== undefined) {
    const effectiveParentId = input.parentId !== undefined ? input.parentId : (current.parentId ?? null)
    const effectiveType     = input.type ?? current.type
    await validateParent(projectId, effectiveParentId, effectiveType)
  }

  // When the status changes, derive startedAt/completedAt from the new status's category.
  const statusTs =
    input.statusId !== undefined && input.statusId !== current.statusId
      ? await computeStatusTimestamps(projectId, input.statusId, current)
      : null

  // When category changes, inherit the new category's sprint assignment
  let inheritedSprintId: string | null | undefined = undefined
  if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
    const [cat] = await db
      .select({ sprintId: categories.sprintId })
      .from(categories)
      .where(eq(categories.id, input.categoryId))
      .limit(1)
    if (!cat) throw new Error('CATEGORY_NOT_FOUND')
    inheritedSprintId = cat.sprintId ?? null
  }

  const [issue] = await db
    .update(issues)
    .set({
      ...(input.title          !== undefined && { title: input.title }),
      ...(input.description    !== undefined && { description: input.description }),
      ...(input.type           !== undefined && { type: input.type }),
      ...(input.categoryId     !== undefined && { categoryId: input.categoryId }),
      ...(inheritedSprintId    !== undefined && { sprintId: inheritedSprintId }),
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
  return response
}

// =============================================================================
// DELETE ISSUE  (soft delete)
// =============================================================================

export const deleteIssue = async (projectId: string, issueId: string): Promise<void> => {
  await db.transaction(async (tx) => {
    const now = new Date()

    const [issue] = await tx
      .update(issues)
      .set({ deletedAt: now })
      .where(and(
        eq(issues.id, issueId),
        eq(issues.projectId, projectId),
        isNull(issues.deletedAt),
      ))
      .returning({ id: issues.id })

    if (!issue) throw new Error('ISSUE_NOT_FOUND')

    // A subtask cannot outlive its parent — soft-delete children with it
    await tx
      .update(issues)
      .set({ deletedAt: now })
      .where(and(
        eq(issues.parentId, issueId),
        isNull(issues.deletedAt),
      ))
  })
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
 * Enforces the subtask hierarchy rules for a (parentId, type) combination:
 *   - only subtasks may have a parent           → PARENT_NOT_ALLOWED
 *   - the parent must be an active issue in the
 *     same project                              → PARENT_NOT_FOUND
 *   - a subtask cannot itself be a parent (one
 *     level of nesting only — no cycles)        → PARENT_IS_SUBTASK
 * A null/absent parentId is always valid.
 */
async function validateParent(
  projectId: string,
  parentId:  string | null,
  type:      string,
): Promise<void> {
  if (parentId === null) return
  if (type !== 'subtask') throw new Error('PARENT_NOT_ALLOWED')

  const [parent] = await db
    .select({ type: issues.type })
    .from(issues)
    .where(and(
      eq(issues.id, parentId),
      eq(issues.projectId, projectId),
      isNull(issues.deletedAt),
    ))
    .limit(1)

  if (!parent) throw new Error('PARENT_NOT_FOUND')
  if (parent.type === 'subtask') throw new Error('PARENT_IS_SUBTASK')
}

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
  categoryId:     i.categoryId,
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
