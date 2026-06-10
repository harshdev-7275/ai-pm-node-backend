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
import { sprintsRoutes } from '../sprints.routes.js'
import { categoriesRoutes } from '../../categories/categories.routes.js'
import { handleError } from '../../../middleware/errorHandler.js'
import { env } from '../../../config/env.js'
import { db } from '../../../db/index.js'
import { issues, issueStatuses, categories } from '../../../db/schema.js'
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
  await app.register(orgsRoutes,     { prefix: '/orgs' })
  await app.register(projectsRoutes, { prefix: '/orgs/:slug/projects' })
  await app.register(issuesRoutes,   { prefix: '/orgs/:slug/projects/:projectId/issues' })
  await app.register(sprintsRoutes,  { prefix: '/orgs/:slug/projects/:projectId/sprints' })
  await app.register(categoriesRoutes, { prefix: '/orgs/:slug/projects/:projectId/categories' })

  await app.ready()
  return app
}

// =============================================================================
// TESTS
// =============================================================================

describe('Sprints API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  let ownerToken:    string
  let outsiderToken: string
  let orgSlug:       string
  let projectId:     string
  let issueId:       string
  let categoryId:    string   // sprint membership is category-level — issues inherit it
  let defaultStatusId: string

  let sprintId:  string   // main sprint: flows planned → active → completed
  let sprint2Id: string   // second sprint used for conflict + issue + delete tests

  const ts            = Date.now()
  const ownerEmail    = `sprints_owner_${ts}@test.com`
  const outsiderEmail = `sprints_out_${ts}@test.com`
  const PROJECT_KEY   = `SPR${ts.toString().slice(-4)}`

  beforeAll(async () => {
    app = await buildTestApp()

    // 1 — Register owner
    const ownerRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Sprint Owner', email: ownerEmail, password: 'password123' })
    ownerToken = ownerRes.body.accessToken

    // 2 — Create org
    const orgRes = await supertest(app.server)
      .post('/orgs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Sprints Test Org' })
    orgSlug = orgRes.body.slug

    // 3 — Create project (seeds 5 default statuses)
    const projectRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Sprints Project', key: PROJECT_KEY })
    projectId = projectRes.body.id

    // 4 — Grab default status from DB
    const statuses = await db
      .select()
      .from(issueStatuses)
      .where(eq(issueStatuses.projectId, projectId))
      .orderBy(issueStatuses.position)
    defaultStatusId = statuses[0]!.id

    // 5 — Create a category (categoryId is required on every issue) and an
    //     issue inside it — sprint membership is driven by the category
    const categoryRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects/${projectId}/categories`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Sprint Test Category' })
    categoryId = categoryRes.body.id

    const issueRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Sprint test issue', statusId: defaultStatusId, categoryId })
    issueId = issueRes.body.id

    // 6 — Register outsider (never joins the org)
    const outsiderRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Outsider', email: outsiderEmail, password: 'password123' })
    outsiderToken = outsiderRes.body.accessToken
  }, 60000)

  afterAll(async () => {
    await app.close()
  }, 30000)

  // ===========================================================================
  describe('POST /sprints', () => {

    it('should create a sprint with status planned and return 201', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/sprints`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Sprint 1', goal: 'Ship the core feature' })

      expect(res.status).toBe(201)
      expect(res.body.name).toBe('Sprint 1')
      expect(res.body.goal).toBe('Ship the core feature')
      expect(res.body.status).toBe('planned')
      expect(res.body.id).toBeDefined()
      expect(res.body.projectId).toBe(projectId)

      sprintId = res.body.id
    })

    it('should reject missing name — 400', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/sprints`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ goal: 'No name provided' })

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('VALIDATION_ERROR')
    })

    it('should reject non-members — 403', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/sprints`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ name: 'Ghost sprint' })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })
  })

  // ===========================================================================
  describe('GET /sprints', () => {

    it('should return all sprints for the project', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/sprints`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body.length).toBeGreaterThanOrEqual(1)
      expect(res.body.some((s: { id: string }) => s.id === sprintId)).toBe(true)
    })

    it('should return empty array when no sprints exist', async () => {
      const ts2 = Date.now()
      const emptyProjectRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Empty Project', key: `EMP${ts2.toString().slice(-4)}` })
      const emptyProjectId = emptyProjectRes.body.id

      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${emptyProjectId}/sprints`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })
  })

  // ===========================================================================
  describe('GET /sprints/:sprintId', () => {

    it('should return sprint detail with issues array, issueCount, and pointsTotal', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/sprints/${sprintId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(sprintId)
      expect(res.body.name).toBe('Sprint 1')
      expect(res.body.status).toBe('planned')
      expect(Array.isArray(res.body.issues)).toBe(true)
      expect(typeof res.body.issueCount).toBe('number')
      expect(typeof res.body.pointsTotal).toBe('number')
    })

    it('should return 404 for non-existent sprint', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/sprints/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(404)
      expect(res.body.code).toBe('SPRINT_NOT_FOUND')
    })
  })

  // ===========================================================================
  describe('PATCH /sprints/:sprintId', () => {

    it('should update name and goal successfully', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/sprints/${sprintId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Sprint 1 — Revised', goal: 'Updated goal' })

      expect(res.status).toBe(200)
      expect(res.body.name).toBe('Sprint 1 — Revised')
      expect(res.body.goal).toBe('Updated goal')
    })
  })

  // ===========================================================================
  describe('POST /sprints/:sprintId/start', () => {

    it('should change status from planned to active', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/sprints/${sprintId}/start`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('active')
      expect(res.body.id).toBe(sprintId)
    })

    it('should reject starting a new sprint when one is already active — 409', async () => {
      // Create sprint2 (planned) and try to start while sprintId is active
      const createRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/sprints`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Sprint 2' })
      sprint2Id = createRes.body.id

      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/sprints/${sprint2Id}/start`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(409)
      expect(res.body.code).toBe('ACTIVE_SPRINT_EXISTS')
    })

    it('should reject starting an already active sprint — 400', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/sprints/${sprintId}/start`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('SPRINT_ALREADY_STARTED')
    })
  })

  // ===========================================================================
  describe('POST /sprints/:sprintId/complete', () => {

    it('should reject completing a planned sprint — 400', async () => {
      // sprint2Id is still planned
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/sprints/${sprint2Id}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('SPRINT_NOT_ACTIVE')
    })

    it('should change status from active to completed', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/sprints/${sprintId}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.completedSprint.status).toBe('completed')
      expect(res.body.completedSprint.id).toBe(sprintId)
    })
  })

  // ===========================================================================
  // Runs after sprintId is completed
  describe('PATCH /sprints/:sprintId (completed)', () => {

    it('should reject updating a completed sprint — 400', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/sprints/${sprintId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Cannot change this' })

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('SPRINT_COMPLETED')
    })
  })

  // ===========================================================================
  // Sprint membership is category-level: assigning a category to a sprint
  // cascades sprintId onto all the category's issues.
  describe('POST /categories/:categoryId/assign-sprint', () => {

    it('should assign the category and cascade sprintId onto its issues', async () => {
      // sprint2Id is still planned — use it for assign/unassign tests
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/categories/${categoryId}/assign-sprint`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ sprintId: sprint2Id })

      expect(res.status).toBe(200)
      expect(res.body.sprintId).toBe(sprint2Id)

      const [row] = await db
        .select({ sprintId: issues.sprintId })
        .from(issues)
        .where(eq(issues.id, issueId))
        .limit(1)

      expect(row?.sprintId).toBe(sprint2Id)
    })

    it('should reject assigning a category to a completed sprint — 400', async () => {
      // sprintId was completed in the describe above
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/categories/${categoryId}/assign-sprint`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ sprintId })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('SPRINT_COMPLETED')
    })
  })

  // ===========================================================================
  describe('DELETE /categories/:categoryId/assign-sprint', () => {

    it('should unassign the category and clear sprintId on its issues', async () => {
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/categories/${categoryId}/assign-sprint`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.sprintId).toBeNull()

      const [row] = await db
        .select({ sprintId: issues.sprintId })
        .from(issues)
        .where(eq(issues.id, issueId))
        .limit(1)

      expect(row?.sprintId).toBeNull()
    })
  })

  // ===========================================================================
  describe('DELETE /sprints/:sprintId', () => {

    it('should reject deleting an active sprint — 400', async () => {
      // No active sprint exists (sprintId is completed) — create + start a fresh one
      const createRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/sprints`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Sprint to delete (active)' })
      const tempId = createRes.body.id

      await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/sprints/${tempId}/start`)
        .set('Authorization', `Bearer ${ownerToken}`)

      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/sprints/${tempId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('SPRINT_ACTIVE')
    })

    it('should delete a planned sprint, unassign its categories and move issues to the backlog', async () => {
      // Re-assign the category to sprint2 so we can verify backlog move on delete
      await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/categories/${categoryId}/assign-sprint`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ sprintId: sprint2Id })

      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/sprints/${sprint2Id}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(204)

      // Verify the issue's sprintId was cleared (back to backlog)
      const [row] = await db
        .select({ sprintId: issues.sprintId })
        .from(issues)
        .where(eq(issues.id, issueId))
        .limit(1)

      expect(row?.sprintId).toBeNull()

      // Verify the category itself was unassigned from the deleted sprint
      const [cat] = await db
        .select({ sprintId: categories.sprintId })
        .from(categories)
        .where(eq(categories.id, categoryId))
        .limit(1)

      expect(cat?.sprintId).toBeNull()
    })
  })

  // ===========================================================================
  describe('complete sprint — only unfinished issues move to backlog', () => {
    it('keeps done issues in the sprint and moves unfinished ones to the backlog', async () => {
      // Fresh project so its sprint/statuses are isolated from the shared state above
      const projRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Complete Behaviour', key: `CB${ts.toString().slice(-4)}` })
      const pid = projRes.body.id

      const statusesRes = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${pid}/issues/statuses`)
        .set('Authorization', `Bearer ${ownerToken}`)
      const todo = statusesRes.body.find((s: { category: string }) => s.category === 'todo').id
      const done = statusesRes.body.find((s: { category: string }) => s.category === 'done').id

      const cbCategoryId = (await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${pid}/categories`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'CB Category' })).body.id

      const doneIssue = (await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${pid}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Finished work', statusId: todo, categoryId: cbCategoryId })).body.id
      const openIssue = (await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${pid}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Unfinished work', statusId: todo, categoryId: cbCategoryId })).body.id

      const sprint = (await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${pid}/sprints`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'CB Sprint' })).body.id

      // Assign the category — both issues inherit the sprint via the cascade
      await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${pid}/categories/${cbCategoryId}/assign-sprint`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ sprintId: sprint })

      // Mark one issue done, then start + complete the sprint
      await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${pid}/issues/${doneIssue}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ statusId: done })
      await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${pid}/sprints/${sprint}/start`)
        .set('Authorization', `Bearer ${ownerToken}`)
      const completeRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${pid}/sprints/${sprint}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ moveIncomplete: true })

      expect(completeRes.status).toBe(200)

      const rows = await db
        .select({ id: issues.id, sprintId: issues.sprintId })
        .from(issues)
        .where(eq(issues.projectId, pid))
      const sprintOf = (id: string): string | null => rows.find(r => r.id === id)?.sprintId ?? null

      expect(sprintOf(doneIssue)).toBe(sprint)   // completed work stays in the sprint
      expect(sprintOf(openIssue)).toBeNull()      // unfinished work returns to the backlog
    }, 30000)
  })
})
