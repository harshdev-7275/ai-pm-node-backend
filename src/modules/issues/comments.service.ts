import { and, eq, isNull, asc } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { issueComments, users } from '../../db/schema.js'
import type { CreateCommentInput, UpdateCommentInput, CommentResponse } from './issues.types.js'

// =============================================================================
// GET COMMENTS BY ISSUE
// =============================================================================

export const getCommentsByIssue = async (issueId: string): Promise<CommentResponse[]> => {
  const rows = await db
    .select({ comment: issueComments, author: users })
    .from(issueComments)
    .innerJoin(users, eq(issueComments.authorId, users.id))
    .where(and(
      eq(issueComments.issueId, issueId),
      isNull(issueComments.deletedAt),
    ))
    .orderBy(asc(issueComments.createdAt))

  return rows.map(toResponse)
}

// =============================================================================
// CREATE COMMENT
// =============================================================================

export const createComment = async (
  input:    CreateCommentInput,
  issueId:  string,
  authorId: string,
): Promise<CommentResponse> => {
  const [row] = await db
    .insert(issueComments)
    .values({
      issueId,
      authorId,
      body:     input.body,
      parentId: input.parentId ?? null,
    })
    .returning()

  if (!row) throw new Error('COMMENT_CREATION_FAILED')

  const [authorRow] = await db
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, authorId))
    .limit(1)

  if (!authorRow) throw new Error('COMMENT_CREATION_FAILED')

  return toResponse({ comment: row, author: authorRow })
}

// =============================================================================
// UPDATE COMMENT  (author only)
// =============================================================================

export const updateComment = async (
  commentId: string,
  authorId:  string,
  input:     UpdateCommentInput,
): Promise<CommentResponse> => {
  const [existing] = await db
    .select()
    .from(issueComments)
    .where(and(eq(issueComments.id, commentId), isNull(issueComments.deletedAt)))
    .limit(1)

  if (!existing) throw new Error('COMMENT_NOT_FOUND')
  if (existing.authorId !== authorId) throw new Error('COMMENT_FORBIDDEN')

  const [row] = await db
    .update(issueComments)
    .set({ body: input.body, isEdited: true })
    .where(eq(issueComments.id, commentId))
    .returning()

  if (!row) throw new Error('COMMENT_NOT_FOUND')

  const [authorRow] = await db
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, row.authorId))
    .limit(1)

  if (!authorRow) throw new Error('COMMENT_NOT_FOUND')

  return toResponse({ comment: row, author: authorRow })
}

// =============================================================================
// DELETE COMMENT  (soft delete — body replaced with "[deleted]", author only)
// =============================================================================

export const deleteComment = async (commentId: string, authorId: string): Promise<void> => {
  const [existing] = await db
    .select()
    .from(issueComments)
    .where(and(eq(issueComments.id, commentId), isNull(issueComments.deletedAt)))
    .limit(1)

  if (!existing) throw new Error('COMMENT_NOT_FOUND')
  if (existing.authorId !== authorId) throw new Error('COMMENT_FORBIDDEN')

  await db
    .update(issueComments)
    .set({ body: '[deleted]', deletedAt: new Date() })
    .where(eq(issueComments.id, commentId))
}

// =============================================================================
// HELPERS
// =============================================================================

const toResponse = (row: {
  comment: typeof issueComments.$inferSelect
  author:  { id: string; name: string; avatarUrl: string | null }
}): CommentResponse => ({
  id:        row.comment.id,
  issueId:   row.comment.issueId,
  body:      row.comment.body,
  isEdited:  row.comment.isEdited,
  parentId:  row.comment.parentId ?? null,
  author: {
    id:        row.author.id,
    name:      row.author.name,
    avatarUrl: row.author.avatarUrl ?? null,
  },
  createdAt: row.comment.createdAt.toISOString(),
  updatedAt: row.comment.updatedAt.toISOString(),
})
