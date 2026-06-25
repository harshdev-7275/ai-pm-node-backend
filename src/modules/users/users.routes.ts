import type { FastifyInstance } from 'fastify'
import * as usersService from './users.service.js'

const userResponseSchema = {
  type: 'object' as const,
  properties: {
    id:        { type: 'string' },
    name:      { type: 'string' },
    email:     { type: 'string' },
    avatarUrl: { type: 'string', nullable: true },
    jobTitle:  { type: 'string', nullable: true },
    timezone:  { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
}

const errorSchema = {
  type: 'object' as const,
  properties: {
    error:   { type: 'string' },
    message: { type: 'string' },
  },
}

export const usersRoutes = async (app: FastifyInstance) => {

  // POST /me/avatar/upload-url  (protected)
  // Returns a presigned PUT URL the browser uploads the file to directly,
  // plus the object `key` to send back to PATCH /me once the upload succeeds.
  app.post('/me/avatar/upload-url', {
    preHandler: [app.authenticate],
    schema: {
      summary: 'Get a presigned avatar upload URL',
      tags: ['Users'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object' as const,
        properties: {
          contentType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
        },
        required: ['contentType'],
      },
      response: {
        200: {
          type: 'object' as const,
          properties: {
            uploadUrl: { type: 'string' },
            key:       { type: 'string' },
          },
        },
        400: errorSchema,
        401: errorSchema,
        503: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { contentType } = req.body as { contentType: string }
    const result = await usersService.createAvatarUploadUrl(req.user.userId, contentType)
    return reply.status(200).send(result)
  })

  // PATCH /me  (protected)
  // Persist the uploaded avatar key (or null to remove it) and return the
  // updated user with a freshly-signed avatar URL.
  app.patch('/me', {
    preHandler: [app.authenticate],
    schema: {
      summary: 'Update the current user profile',
      tags: ['Users'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object' as const,
        properties: {
          avatarKey: { type: 'string', nullable: true },
        },
      },
      response: {
        200: userResponseSchema,
        400: errorSchema,
        401: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { avatarKey } = req.body as { avatarKey?: string | null }
    const user = await usersService.updateAvatar(req.user.userId, avatarKey ?? null)
    return reply.status(200).send(user)
  })
}
