import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { categories, issues, sprints } from '../../db/schema.js'
import type { CreateCategoryInput, UpdateCategoryInput } from './categories.schema.js'

// =============================================================================
// TYPES
// =============================================================================

export interface CategoryResponse {
  id:          string
  projectId:   string
  orgId:       string
  name:        string
  color:       string
  description: string | null
  sprintId:    string | null
  createdBy:   string
  createdAt:   string
}

// =============================================================================
// LIST
// =============================================================================

export const getProjectCategories = async (projectId: string): Promise<CategoryResponse[]> => {
  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.projectId, projectId))
    .orderBy(categories.createdAt)

  return rows.map(toResponse)
}

// =============================================================================
// CREATE
// =============================================================================

export const createCategory = async (
  input: CreateCategoryInput,
  projectId: string,
  orgId: string,
  userId: string,
): Promise<CategoryResponse> => {
  const [row] = await db
    .insert(categories)
    .values({
      projectId,
      orgId,
      name:        input.name,
      color:       input.color ?? '#6366f1',
      description: input.description ?? null,
      createdBy:   userId,
    })
    .returning()

  if (!row) throw new Error('CATEGORY_CREATION_FAILED')
  return toResponse(row)
}

// =============================================================================
// UPDATE
// =============================================================================

export const updateCategory = async (
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<CategoryResponse> => {
  const [row] = await db
    .update(categories)
    .set({
      ...(input.name        !== undefined && { name: input.name }),
      ...(input.color       !== undefined && { color: input.color }),
      ...(input.description !== undefined && { description: input.description }),
    })
    .where(eq(categories.id, categoryId))
    .returning()

  if (!row) throw new Error('CATEGORY_NOT_FOUND')
  return toResponse(row)
}

// =============================================================================
// DELETE
// =============================================================================

export const deleteCategory = async (categoryId: string): Promise<void> => {
  const [issueCount] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(
      eq(issues.categoryId, categoryId),
      isNull(issues.deletedAt),
    ))
    .limit(1)

  if (issueCount) throw new Error('CATEGORY_HAS_ISSUES')

  const deleted = await db
    .delete(categories)
    .where(eq(categories.id, categoryId))
    .returning({ id: categories.id })

  if (deleted.length === 0) throw new Error('CATEGORY_NOT_FOUND')
}

// =============================================================================
// ASSIGN CATEGORY TO SPRINT
// =============================================================================

export const assignCategoryToSprint = async (
  categoryId: string,
  sprintId: string,
): Promise<CategoryResponse> => {
  // Verify sprint exists and is still open — completed sprints are immutable
  const [sprint] = await db
    .select({ id: sprints.id, status: sprints.status })
    .from(sprints)
    .where(eq(sprints.id, sprintId))
    .limit(1)

  if (!sprint) throw new Error('SPRINT_NOT_FOUND')
  if (sprint.status === 'completed') throw new Error('SPRINT_COMPLETED')

  const [row] = await db.transaction(async (tx) => {
    const updated = await tx
      .update(categories)
      .set({ sprintId })
      .where(eq(categories.id, categoryId))
      .returning()

    // Cascade: all issues in this category inherit the sprint
    await tx
      .update(issues)
      .set({ sprintId })
      .where(and(
        eq(issues.categoryId, categoryId),
        isNull(issues.deletedAt),
      ))

    return updated
  })

  if (!row) throw new Error('CATEGORY_NOT_FOUND')
  return toResponse(row)
}

// =============================================================================
// UNASSIGN CATEGORY FROM SPRINT
// =============================================================================

export const unassignCategoryFromSprint = async (
  categoryId: string,
): Promise<CategoryResponse> => {
  const [row] = await db.transaction(async (tx) => {
    const updated = await tx
      .update(categories)
      .set({ sprintId: null })
      .where(eq(categories.id, categoryId))
      .returning()

    await tx
      .update(issues)
      .set({ sprintId: null })
      .where(and(
        eq(issues.categoryId, categoryId),
        isNull(issues.deletedAt),
      ))

    return updated
  })

  if (!row) throw new Error('CATEGORY_NOT_FOUND')
  return toResponse(row)
}

// =============================================================================
// HELPER
// =============================================================================

const toResponse = (row: typeof categories.$inferSelect): CategoryResponse => ({
  id:          row.id,
  projectId:   row.projectId,
  orgId:       row.orgId,
  name:        row.name,
  color:       row.color,
  description: row.description ?? null,
  sprintId:    row.sprintId ?? null,
  createdBy:   row.createdBy,
  createdAt:   row.createdAt.toISOString(),
})
