import { and, eq, isNull, asc, count } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { sprints, issues, projects, categories } from '../../db/schema.js'
import { AppError } from '../../utils/errors.js'
import type {
  CreateSprintInput,
  UpdateSprintInput,
  SprintResponse,
  SprintDetail,
} from './sprints.types.js'

export interface CompleteSprintResult {
  completedSprint: SprintResponse
  nextSprint:      SprintResponse | null
}

// =============================================================================
// HELPERS
// =============================================================================

function toSprintResponse(row: typeof sprints.$inferSelect): SprintResponse {
  return {
    id:        row.id,
    projectId: row.projectId,
    orgId:     row.orgId,
    name:      row.name,
    goal:      row.goal ?? null,
    status:    row.status,
    startDate: row.startDate?.toISOString() ?? null,
    endDate:   row.endDate?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// =============================================================================
// LIST
// =============================================================================

export const listSprints = async (projectId: string): Promise<SprintResponse[]> => {
  const rows = await db
    .select()
    .from(sprints)
    .where(eq(sprints.projectId, projectId))
    .orderBy(asc(sprints.createdAt))

  return rows.map(toSprintResponse)
}

// =============================================================================
// GET DETAIL (with issues)
// =============================================================================

export const getSprintDetail = async (
  projectId: string,
  sprintId:  string,
): Promise<SprintDetail> => {
  const [sprint] = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.projectId, projectId)))
    .limit(1)

  if (!sprint) throw new AppError('SPRINT_NOT_FOUND', 'Sprint not found', 404)

  const sprintIssues = await db
    .select({
      id:          issues.id,
      number:      issues.number,
      title:       issues.title,
      type:        issues.type,
      priority:    issues.priority,
      statusId:    issues.statusId,
      assigneeId:  issues.assigneeId,
      storyPoints: issues.storyPoints,
    })
    .from(issues)
    .where(and(eq(issues.sprintId, sprintId), isNull(issues.deletedAt)))
    .orderBy(asc(issues.number))

  const pointsTotal = sprintIssues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)

  return {
    ...toSprintResponse(sprint),
    issues:      sprintIssues,
    issueCount:  sprintIssues.length,
    pointsTotal,
  }
}

// =============================================================================
// CREATE
// =============================================================================

export const createSprint = async (
  input:     CreateSprintInput,
  projectId: string,
  orgId:     string,
  userId:    string,
): Promise<SprintResponse> => {
  const [sprint] = await db
    .insert(sprints)
    .values({
      projectId,
      orgId,
      name:      input.name,
      goal:      input.goal ?? null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate:   input.endDate   ? new Date(input.endDate)   : null,
      createdBy: userId,
    })
    .returning()

  if (!sprint) throw new AppError('SPRINT_CREATION_FAILED', 'Failed to create sprint', 500)

  const response = toSprintResponse(sprint)
  return response
}

// =============================================================================
// UPDATE
// =============================================================================

export const updateSprint = async (
  projectId: string,
  sprintId:  string,
  input:     UpdateSprintInput,
): Promise<SprintResponse> => {
  const [existing] = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.projectId, projectId)))
    .limit(1)

  if (!existing) throw new AppError('SPRINT_NOT_FOUND', 'Sprint not found', 404)
  if (existing.status === 'completed') throw new AppError('SPRINT_COMPLETED', 'Cannot edit a completed sprint', 400)

  const [updated] = await db
    .update(sprints)
    .set({
      ...(input.name      !== undefined && { name:      input.name }),
      ...(input.goal      !== undefined && { goal:      input.goal ?? null }),
      ...(input.startDate !== undefined && { startDate: input.startDate ? new Date(input.startDate) : null }),
      ...(input.endDate   !== undefined && { endDate:   input.endDate   ? new Date(input.endDate)   : null }),
    })
    .where(eq(sprints.id, sprintId))
    .returning()

  if (!updated) throw new AppError('SPRINT_UPDATE_FAILED', 'Failed to update sprint', 500)

  const response = toSprintResponse(updated)
  return response
}

// =============================================================================
// DELETE
// =============================================================================

export const deleteSprint = async (projectId: string, sprintId: string): Promise<void> => {
  const [existing] = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.projectId, projectId)))
    .limit(1)

  if (!existing) throw new AppError('SPRINT_NOT_FOUND', 'Sprint not found', 404)
  if (existing.status === 'active') throw new AppError('SPRINT_ACTIVE', 'Complete the sprint before deleting it', 400)

  await db.transaction(async (tx) => {
    // Unassign categories from this sprint
    await tx.update(categories).set({ sprintId: null }).where(eq(categories.sprintId, sprintId))
    // Move all sprint issues back to backlog
    await tx.update(issues).set({ sprintId: null }).where(eq(issues.sprintId, sprintId))
    await tx.delete(sprints).where(eq(sprints.id, sprintId))
  })
}

// =============================================================================
// START SPRINT
// =============================================================================

export const startSprint = async (projectId: string, sprintId: string): Promise<SprintResponse> => {
  const [existing] = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.projectId, projectId)))
    .limit(1)

  if (!existing) throw new AppError('SPRINT_NOT_FOUND', 'Sprint not found', 404)
  if (existing.status !== 'planned') throw new AppError('SPRINT_ALREADY_STARTED', 'Sprint is already active or completed', 400)

  // Only one sprint can be active per project
  const [activeSprint] = await db
    .select({ id: sprints.id })
    .from(sprints)
    .where(and(eq(sprints.projectId, projectId), eq(sprints.status, 'active')))
    .limit(1)

  if (activeSprint) throw new AppError('ACTIVE_SPRINT_EXISTS', 'Complete the current active sprint before starting a new one', 409)

  const now = new Date()
  const [updated] = await db
    .update(sprints)
    .set({
      status:    'active',
      startDate: existing.startDate ?? now,
    })
    .where(eq(sprints.id, sprintId))
    .returning()

  if (!updated) throw new AppError('SPRINT_START_FAILED', 'Failed to start sprint', 500)

  const response = toSprintResponse(updated)
  return response
}

// =============================================================================
// COMPLETE SPRINT
// =============================================================================

export const completeSprint = async (
  projectId:      string,
  sprintId:       string,
  moveIncomplete: boolean = true,
): Promise<CompleteSprintResult> => {
  const [existing] = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.projectId, projectId)))
    .limit(1)

  if (!existing) throw new AppError('SPRINT_NOT_FOUND', 'Sprint not found', 404)
  if (existing.status !== 'active') throw new AppError('SPRINT_NOT_ACTIVE', 'Only an active sprint can be completed', 400)

  if (moveIncomplete) {
    await db
      .update(issues)
      .set({ sprintId: null })
      .where(and(eq(issues.sprintId, sprintId), isNull(issues.completedAt), isNull(issues.deletedAt)))
  }

  // Unassign all categories from this sprint so they're free for the next cycle
  await db.update(categories).set({ sprintId: null }).where(eq(categories.sprintId, sprintId))

  const [updated] = await db
    .update(sprints)
    .set({ status: 'completed', endDate: existing.endDate ?? new Date() })
    .where(eq(sprints.id, sprintId))
    .returning()

  if (!updated) throw new AppError('SPRINT_COMPLETE_FAILED', 'Failed to complete sprint', 500)

  const completedSprint = toSprintResponse(updated)

  const [project] = await db
    .select({ weeklyAutoCreate: projects.weeklyAutoCreate, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project?.weeklyAutoCreate) {
    return { completedSprint, nextSprint: null }
  }

  const countResult = await db
    .select({ sprintCount: count() })
    .from(sprints)
    .where(eq(sprints.projectId, projectId))

  const nextNumber = (countResult[0]?.sprintCount ?? 0) + 1
  const startDate  = new Date()
  const endDate    = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000)

  const [nextRow] = await db
    .insert(sprints)
    .values({
      projectId,
      orgId:     project.orgId,
      name:      `Sprint ${nextNumber}`,
      status:    'planned',
      startDate,
      endDate,
      createdBy: existing.createdBy,
    })
    .returning()

  if (!nextRow) throw new AppError('SPRINT_AUTO_CREATE_FAILED', 'Failed to auto-create next sprint', 500)

  const nextSprint = toSprintResponse(nextRow)
  return { completedSprint, nextSprint }
}
