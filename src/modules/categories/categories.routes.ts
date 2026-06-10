import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireProjectAccess } from '../../middleware/requireProjectAccess.js'
import {
  createCategorySchema,
  updateCategorySchema,
  assignSprintSchema,
} from './categories.schema.js'
import * as categoriesService from './categories.service.js'

const errorSchema = {
  type: 'object' as const,
  properties: { error: { type: 'string' }, message: { type: 'string' } },
}

const categoryResponseSchema = {
  type: 'object' as const,
  properties: {
    id:          { type: 'string' },
    projectId:   { type: 'string' },
    orgId:       { type: 'string' },
    name:        { type: 'string' },
    color:       { type: 'string' },
    description: { type: 'string', nullable: true },
    sprintId:    { type: 'string', nullable: true },
    createdBy:   { type: 'string' },
    createdAt:   { type: 'string', format: 'date-time' },
  },
}

const messageSchema = {
  type: 'object' as const,
  properties: { message: { type: 'string' } },
}

export const categoriesRoutes = async (app: FastifyInstance) => {

  // GET /categories — list all categories in project
  app.get('/', {
    preHandler: [requireProjectAccess('viewer')],
    schema: {
      summary: 'List categories',
      tags:    ['Categories'],
      security: [{ bearerAuth: [] }],
      response: {
        200: { type: 'array' as const, items: categoryResponseSchema },
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params as { slug: string; projectId: string }
    const list = await categoriesService.getProjectCategories(projectId)
    return reply.status(200).send(list)
  })


  // POST /categories — create category
  app.post('/', {
    preHandler: [requireProjectAccess('member')],
    schema: {
      summary: 'Create category',
      tags:    ['Categories'],
      security: [{ bearerAuth: [] }],
      response: {
        201: categoryResponseSchema,
        400: errorSchema,
      },
    },
  }, async (req, reply) => {
    const parsed = createCategorySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error:  'VALIDATION_ERROR',
        issues: parsed.error.issues.map((e: z.core.$ZodIssue) => ({
          field: e.path.join('.'), message: e.message,
        })),
      })
    }

    const { projectId } = req.params as { slug: string; projectId: string }
    const category = await categoriesService.createCategory(
      parsed.data, projectId, req.org.id, req.user.userId,
    )
    return reply.status(201).send(category)
  })


  // PATCH /categories/:categoryId — update category
  app.patch('/:categoryId', {
    preHandler: [requireProjectAccess('member')],
    schema: {
      summary: 'Update category',
      tags:    ['Categories'],
      security: [{ bearerAuth: [] }],
      response: {
        200: categoryResponseSchema,
        400: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { categoryId } = req.params as { slug: string; projectId: string; categoryId: string }
    const parsed = updateCategorySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error:  'VALIDATION_ERROR',
        issues: parsed.error.issues.map((e: z.core.$ZodIssue) => ({
          field: e.path.join('.'), message: e.message,
        })),
      })
    }

    try {
      const category = await categoriesService.updateCategory(categoryId, parsed.data)
      return reply.status(200).send(category)
    } catch (err) {
      if (err instanceof Error && err.message === 'CATEGORY_NOT_FOUND') {
        return reply.status(404).send({ error: 'CATEGORY_NOT_FOUND', message: 'Category not found' })
      }
      throw err
    }
  })


  // DELETE /categories/:categoryId — delete category (lead only)
  app.delete('/:categoryId', {
    preHandler: [requireProjectAccess('lead')],
    schema: {
      summary: 'Delete category',
      tags:    ['Categories'],
      security: [{ bearerAuth: [] }],
      response: {
        200: messageSchema,
        400: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { categoryId } = req.params as { slug: string; projectId: string; categoryId: string }
    try {
      await categoriesService.deleteCategory(categoryId)
      return reply.status(200).send({ message: 'Category deleted' })
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'CATEGORY_NOT_FOUND') {
          return reply.status(404).send({ error: 'CATEGORY_NOT_FOUND', message: 'Category not found' })
        }
        if (err.message === 'CATEGORY_HAS_ISSUES') {
          return reply.status(400).send({ error: 'CATEGORY_HAS_ISSUES', message: 'Cannot delete a category that still has issues. Move or delete its issues first.' })
        }
      }
      throw err
    }
  })


  // POST /categories/:categoryId/assign-sprint — assign category to sprint
  app.post('/:categoryId/assign-sprint', {
    preHandler: [requireProjectAccess('member')],
    schema: {
      summary: 'Assign category to sprint',
      tags:    ['Categories'],
      security: [{ bearerAuth: [] }],
      response: {
        200: categoryResponseSchema,
        400: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { categoryId } = req.params as { slug: string; projectId: string; categoryId: string }
    const parsed = assignSprintSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR', message: 'sprintId is required and must be a valid UUID',
      })
    }

    try {
      const category = await categoriesService.assignCategoryToSprint(categoryId, parsed.data.sprintId)
      return reply.status(200).send(category)
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'CATEGORY_NOT_FOUND') {
          return reply.status(404).send({ error: 'CATEGORY_NOT_FOUND', message: 'Category not found' })
        }
        if (err.message === 'SPRINT_NOT_FOUND') {
          return reply.status(404).send({ error: 'SPRINT_NOT_FOUND', message: 'Sprint not found' })
        }
        if (err.message === 'SPRINT_COMPLETED') {
          return reply.status(400).send({ error: 'SPRINT_COMPLETED', message: 'Cannot assign a category to a completed sprint' })
        }
      }
      throw err
    }
  })


  // DELETE /categories/:categoryId/assign-sprint — unassign category from sprint
  app.delete('/:categoryId/assign-sprint', {
    preHandler: [requireProjectAccess('member')],
    schema: {
      summary: 'Unassign category from sprint',
      tags:    ['Categories'],
      security: [{ bearerAuth: [] }],
      response: {
        200: categoryResponseSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const { categoryId } = req.params as { slug: string; projectId: string; categoryId: string }
    try {
      const category = await categoriesService.unassignCategoryFromSprint(categoryId)
      return reply.status(200).send(category)
    } catch (err) {
      if (err instanceof Error && err.message === 'CATEGORY_NOT_FOUND') {
        return reply.status(404).send({ error: 'CATEGORY_NOT_FOUND', message: 'Category not found' })
      }
      throw err
    }
  })
}
