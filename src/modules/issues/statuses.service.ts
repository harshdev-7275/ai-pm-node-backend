import { and, asc, count, eq, gt, gte, isNull, lt, lte, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { issueStatuses, issues } from '../../db/schema.js'
import type { CreateStatusInput, StatusResponse, UpdateStatusInput } from './issues.types.js'

// =============================================================================
// GET STATUSES
// =============================================================================

export const getStatuses = async (projectId: string): Promise<StatusResponse[]> => {
  const rows = await db
    .select()
    .from(issueStatuses)
    .where(eq(issueStatuses.projectId, projectId))
    .orderBy(asc(issueStatuses.position))

  return rows.map(toResponse)
}

// =============================================================================
// CREATE STATUS
// =============================================================================

export const createStatus = async (
  input:     CreateStatusInput,
  projectId: string,
): Promise<StatusResponse> => {
  const [maxRow] = await db
    .select({ maxPos: sql<number>`max(${issueStatuses.position})` })
    .from(issueStatuses)
    .where(eq(issueStatuses.projectId, projectId))

  const nextPosition = (maxRow?.maxPos ?? 0) + 1

  const [status] = await db
    .insert(issueStatuses)
    .values({
      projectId,
      name:      input.name,
      color:     input.color,
      position:  nextPosition,
      isDefault: false,
      category:  input.category,
    })
    .returning()

  if (!status) throw new Error('STATUS_CREATION_FAILED')
  return toResponse(status)
}

// =============================================================================
// UPDATE STATUS
// =============================================================================

export const updateStatus = async (
  statusId:  string,
  projectId: string,
  input:     UpdateStatusInput,
): Promise<StatusResponse> => {
  const [current] = await db
    .select()
    .from(issueStatuses)
    .where(and(
      eq(issueStatuses.id, statusId),
      eq(issueStatuses.projectId, projectId),
    ))
    .limit(1)

  if (!current) throw new Error('STATUS_NOT_FOUND')

  let updated: typeof issueStatuses.$inferSelect

  if (input.position !== undefined && input.position !== current.position) {
    // Position is changing — shift siblings atomically to keep positions gapless
    const result = await db.transaction(async (tx) => {
      const oldPos = current.position
      const newPos = input.position!

      if (newPos < oldPos) {
        // Moving up: bump statuses in [newPos, oldPos-1] down one slot
        await tx
          .update(issueStatuses)
          .set({ position: sql`${issueStatuses.position} + 1` })
          .where(and(
            eq(issueStatuses.projectId, projectId),
            gte(issueStatuses.position, newPos),
            lt(issueStatuses.position, oldPos),
          ))
      } else {
        // Moving down: pull statuses in [oldPos+1, newPos] up one slot
        await tx
          .update(issueStatuses)
          .set({ position: sql`${issueStatuses.position} - 1` })
          .where(and(
            eq(issueStatuses.projectId, projectId),
            gt(issueStatuses.position, oldPos),
            lte(issueStatuses.position, newPos),
          ))
      }

      const [row] = await tx
        .update(issueStatuses)
        .set({
          ...(input.name     !== undefined && { name: input.name }),
          ...(input.color    !== undefined && { color: input.color }),
          ...(input.category !== undefined && { category: input.category }),
          position: newPos,
        })
        .where(eq(issueStatuses.id, statusId))
        .returning()

      if (!row) throw new Error('STATUS_NOT_FOUND')
      return row
    })
    updated = result
  } else {
    const [row] = await db
      .update(issueStatuses)
      .set({
        ...(input.name     !== undefined && { name: input.name }),
        ...(input.color    !== undefined && { color: input.color }),
        ...(input.category !== undefined && { category: input.category }),
      })
      .where(eq(issueStatuses.id, statusId))
      .returning()

    if (!row) throw new Error('STATUS_NOT_FOUND')
    updated = row
  }

  return toResponse(updated)
}

// =============================================================================
// DELETE STATUS
// =============================================================================

export const deleteStatus = async (statusId: string, projectId: string): Promise<void> => {
  const [status] = await db
    .select()
    .from(issueStatuses)
    .where(and(
      eq(issueStatuses.id, statusId),
      eq(issueStatuses.projectId, projectId),
    ))
    .limit(1)

  if (!status) throw new Error('STATUS_NOT_FOUND')

  // Safety: project must always have at least one status
  const [countRow] = await db
    .select({ total: count() })
    .from(issueStatuses)
    .where(eq(issueStatuses.projectId, projectId))

  if ((countRow?.total ?? 0) <= 1) throw new Error('LAST_STATUS')

  // Safety: can't delete a status that still has active issues
  const [issueCountRow] = await db
    .select({ total: count() })
    .from(issues)
    .where(and(
      eq(issues.statusId, statusId),
      isNull(issues.deletedAt),
    ))

  const issueCount = issueCountRow?.total ?? 0
  if (issueCount > 0) {
    const err = new Error('STATUS_HAS_ISSUES') as Error & { issueCount: number }
    err.issueCount = issueCount
    throw err
  }

  await db.delete(issueStatuses).where(eq(issueStatuses.id, statusId))
}

// =============================================================================
// HELPER
// =============================================================================

const toResponse = (s: typeof issueStatuses.$inferSelect): StatusResponse => ({
  id:        s.id,
  projectId: s.projectId,
  name:      s.name,
  color:     s.color,
  position:  s.position,
  isDefault: s.isDefault,
  category:  s.category,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
})
