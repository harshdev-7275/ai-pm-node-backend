import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import supertest from 'supertest'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import { authRoutes } from '../../auth/auth.routes.js'
import { orgsRoutes } from '../../orgs/orgs.routes.js'
import { projectsRoutes } from '../../projects/projects.routes.js'
import { issuesRoutes } from '../../issues/issues.routes.js'
import { sprintsRoutes } from '../../sprints/sprints.routes.js'
import { categoriesRoutes } from '../categories.routes.js'
import { handleError } from '../../../middleware/errorHandler.js'
import { env } from '../../../config/env.js'
import { db } from '../../../db/index.js'
import { issues, issueStatuses } from '../../../db/schema.js'
import { eq } from 'drizzle-orm'

// =============================================================================
// TEST APP SETUP
// =============================================================================

const buildTestApp = async () => {
  const app = Fastify()

  await app.register(cors, { origin: true })
  await app.register(jwt,    { secret: env.JWT_SECRET })
  await app.register(cookie, { secret: env.JWT_SECRET })

  app.decorate('authenticate', async (req: any, reply: any) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '')
      if (!token) return reply.status(401).send({ error: 'UNAUTHORIZED' })
      req.user = app.jwt.verify(token)
    } catch {
      return reply.status(401).send({ error: 'UNAUTHORIZED' })
    }
  })

  app.setErrorHandler((error, request, reply) => {
    handleError(error, {
      logError: (obj, msg) => { request.log.error(obj, msg) },
      send:     (statusCode, body) => { void reply.status(statusCode).send(body) },
    })
  })

  await app.register(authRoutes)
  await app.register(orgsRoutes,       { prefix: '/orgs' })
  await app.register(projectsRoutes,   { prefix: '/orgs/:slug/projects' })
  await app.register(issuesRoutes,     { prefix: '/orgs/:slug/projects/:projectId/issues' })
  await app.register(sprintsRoutes,    { prefix: '/orgs/:slug/projects/:projectId/sprints' })
  await app.register(categoriesRoutes, { prefix: '/orgs/:slug/projects/:projectId/categories' })

  await app.ready()
  return app
}

// =============================================================================
// TESTS
// =============================================================================

describe('Categories API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  let ownerToken:    string
  let outsiderToken: string
  let orgSlug:       string
  let projectId:     string
  let defaultStatusId: string

  let categoryId: string   // created in POST tests, reused throughout

  const ts            = Date.now()
  const ownerEmail    = `cat_owner_${ts}@test.com`
  const outsiderEmail = `cat_out_${ts}@test.com`
  const PROJECT_KEY   = `CAT${ts.toString().slice(-4)}`

  beforeAll(async () => {
    app = await buildTestApp()

    // 1 — Register owner
    const ownerRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Category Owner', email: ownerEmail, password: 'password123' })
    ownerToken = ownerRes.body.accessToken

    // 2 — Create org
    const orgRes = await supertest(app.server)
      .post('/orgs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Categories Test Org' })
    orgSlug = orgRes.body.slug

    // 3 — Create project (seeds default statuses)
    const projectRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Categories Project', key: PROJECT_KEY })
    projectId = projectRes.body.id

    // 4 — Grab default status from DB (needed to create issues)
    const statuses = await db
      .select()
      .from(issueStatuses)
      .where(eq(issueStatuses.projectId, projectId))
      .orderBy(issueStatuses.position)
    defaultStatusId = statuses[0]!.id

    // 5 — Register outsider (never joins the org)
    const outsiderRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Category Outsider', email: outsiderEmail, password: 'password123' })
    outsiderToken = outsiderRes.body.accessToken
  }, 60000)

  afterAll(async () => {
    await app.close()
  }, 30000)

  // ===========================================================================
  describe('GET /categories', () => {

    it('should return an empty array when the project has no categories', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/categories`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })

    it('should reject non-members — 403', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/categories`)
        .set('Authorization', `Bearer ${outsiderToken}`)

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })
  })

  // ===========================================================================
  describe('POST /categories', () => {

    it('should create a category with the default color and return 201', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/categories`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Auth' })

      expect(res.status).toBe(201)
      expect(res.body.name).toBe('Auth')
      expect(res.body.color).toBe('#6366f1')
      expect(res.body.projectId).toBe(projectId)
      expect(res.body.sprintId).toBeNull()
      expect(res.body.id).toBeDefined()

      categoryId = res.body.id
    })

    it('should accept a custom color and description', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/categories`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Payments', color: '#22c55e', description: 'Billing work' })

      expect(res.status).toBe(201)
      expect(res.body.color).toBe('#22c55e')
      expect(res.body.description).toBe('Billing work')
    })

    it('should reject a missing name — 400', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/categories`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ color: '#22c55e' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
    })

    it('should reject non-members — 403', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/categories`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ name: 'Ghost category' })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })
  })

  // ===========================================================================
  describe('PATCH /categories/:categoryId', () => {

    it('should update name and color', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/categories/${categoryId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Auth & Security', color: '#ef4444' })

      expect(res.status).toBe(200)
      expect(res.body.name).toBe('Auth & Security')
      expect(res.body.color).toBe('#ef4444')
    })

    it('should return 404 for a non-existent category', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/categories/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Nope' })

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('CATEGORY_NOT_FOUND')
    })
  })

  // ===========================================================================
  describe('sprint assignment + new-issue inheritance', () => {
    let sprintId: string

    it('should 404 when assigning to a non-existent sprint', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/categories/${categoryId}/assign-sprint`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ sprintId: '00000000-0000-0000-0000-000000000000' })

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('SPRINT_NOT_FOUND')
    })

    it('a new issue created in a sprint-assigned category inherits its sprintId', async () => {
      const sprintRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/sprints`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Inherit Sprint' })
      sprintId = sprintRes.body.id

      await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/categories/${categoryId}/assign-sprint`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ sprintId })

      const issueRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Inherits sprint', statusId: defaultStatusId, categoryId })

      expect(issueRes.status).toBe(201)
      expect(issueRes.body.sprintId).toBe(sprintId)
    })

    it('should unassign and clear sprintId on the category and its issues', async () => {
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/categories/${categoryId}/assign-sprint`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.sprintId).toBeNull()

      const rows = await db
        .select({ sprintId: issues.sprintId })
        .from(issues)
        .where(eq(issues.categoryId, categoryId))

      expect(rows.every((r) => r.sprintId === null)).toBe(true)
    })

    it('should 404 when unassigning a non-existent category', async () => {
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/categories/00000000-0000-0000-0000-000000000000/assign-sprint`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('CATEGORY_NOT_FOUND')
    })
  })

  // ===========================================================================
  describe('DELETE /categories/:categoryId', () => {

    it('should reject deleting a category that still has issues — 400', async () => {
      // categoryId has the "Inherits sprint" issue from the describe above
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/categories/${categoryId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('CATEGORY_HAS_ISSUES')
    })

    it('should delete an empty category — 200', async () => {
      const createRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/categories`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Empty — safe to delete' })

      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/categories/${createRes.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.message).toBeDefined()

      const listRes = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/categories`)
        .set('Authorization', `Bearer ${ownerToken}`)
      expect(listRes.body.some((c: { id: string }) => c.id === createRes.body.id)).toBe(false)
    })

    it('should return 404 for a non-existent category', async () => {
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/categories/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('CATEGORY_NOT_FOUND')
    })
  })
})
