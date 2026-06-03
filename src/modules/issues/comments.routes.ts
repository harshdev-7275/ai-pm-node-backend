import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createCommentSchema, updateCommentSchema } from './issues.schema.js'
import { requireProjectAccess } from '../../middleware/requireProjectAccess.js'
import * as commentsService from './comments.service.js'

// =============================================================================
// RESPONSE SCHEMAS
// =============================================================================

const errorSchema = {
  type: 'object' as const,
  properties: { error: { type: 'string' }, message: { type: 'string' } },
}

const messageSchema = {
  type: 'object' as const,
  properties: { message: { type: 'string' } },
}

const commentAuthorSchema = {
  type: 'object' as const,
  properties: {
    id:        { type: 'string' },
    name:      { type: 'string' },
    avatarUrl: { type: 'string', nullable: true },
  },
}

const commentResponseSchema = {
  type: 'object' as const,
  properties: {
    id:        { type: 'string' },
    issueId:   { type: 'string' },
    body:      { type: 'string' },
    isEdited:  { type: 'boolean' },
    parentId:  { type: 'string', nullable: true },
    author:    commentAuthorSchema,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
}

// =============================================================================
// ROUTES
// Registered under /orgs/:slug/projects/:projectId/issues in app.ts
// Handles /:issueId/comments and /:issueId/comments/:commentId
// =============================================================================

export const commentsRoutes = async (app: FastifyInstance) => {

  // GET /:issueId/comments — list all comments on an issue
  app.get('/:issueId/comments', {
    preHandler: [requireProjectAccess('viewer')],
    schema: {
      summary:     'List comments',
      description: 'Returns all non-deleted comments on an issue ordered by creation time',
      tags:        ['Comments'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: { type: 'array' as const, items: commentResponseSchema },
      },
    },
  }, async (req, reply) => {
    const { issueId } = req.params as { issueId: string }
    const comments = await commentsService.getCommentsByIssue(issueId)
    return reply.status(200).send(comments)
  })


  // POST /:issueId/comments — add a comment to an issue
  app.post('/:issueId/comments', {
    preHandler: [requireProjectAccess('viewer')],
    schema: {
      summary:     'Create comment',
      description: 'Adds a comment (or threaded reply) to an issue',
      tags:        ['Comments'],
      security:    [{ bearerAuth: [] }],
      response: {
        201: commentResponseSchema,
        400: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { issueId } = req.params as { issueId: string }

    const parsed = createCommentSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error:  'VALIDATION_ERROR',
        issues: parsed.error.issues.map((e: z.core.$ZodIssue) => ({
          field:   e.path.join('.'),
          message: e.message,
        })),
      })
    }

    const comment = await commentsService.createComment(parsed.data, issueId, req.user.userId)
    return reply.status(201).send(comment)
  })


  // PATCH /:issueId/comments/:commentId — edit a comment (author only)
  app.patch('/:issueId/comments/:commentId', {
    preHandler: [requireProjectAccess('viewer')],
    schema: {
      summary:     'Update comment',
      description: 'Edits the body of a comment — only the original author may do this',
      tags:        ['Comments'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: commentResponseSchema,
        400: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { commentId } = req.params as { issueId: string; commentId: string }

    const parsed = updateCommentSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error:  'VALIDATION_ERROR',
        issues: parsed.error.issues.map((e: z.core.$ZodIssue) => ({
          field:   e.path.join('.'),
          message: e.message,
        })),
      })
    }

    try {
      const comment = await commentsService.updateComment(commentId, req.user.userId, parsed.data)
      return reply.status(200).send(comment)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'COMMENT_NOT_FOUND') {
        return reply.status(404).send({ error: 'COMMENT_NOT_FOUND', message: 'Comment not found' })
      }
      if (err instanceof Error && err.message === 'COMMENT_FORBIDDEN') {
        return reply.status(403).send({ error: 'COMMENT_FORBIDDEN', message: 'Only the author can edit this comment' })
      }
      throw err
    }
  })


  // DELETE /:issueId/comments/:commentId — soft delete (author only)
  app.delete('/:issueId/comments/:commentId', {
    preHandler: [requireProjectAccess('viewer')],
    schema: {
      summary:     'Delete comment',
      description: 'Soft-deletes a comment and replaces its body with "[deleted]" — only the author may do this',
      tags:        ['Comments'],
      security:    [{ bearerAuth: [] }],
      response: {
        200: messageSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { commentId } = req.params as { issueId: string; commentId: string }

    try {
      await commentsService.deleteComment(commentId, req.user.userId)
      return reply.status(200).send({ message: 'Comment deleted' })
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'COMMENT_NOT_FOUND') {
        return reply.status(404).send({ error: 'COMMENT_NOT_FOUND', message: 'Comment not found' })
      }
      if (err instanceof Error && err.message === 'COMMENT_FORBIDDEN') {
        return reply.status(403).send({ error: 'COMMENT_FORBIDDEN', message: 'Only the author can delete this comment' })
      }
      throw err
    }
  })
}
