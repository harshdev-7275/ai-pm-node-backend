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
  await app.register(orgsRoutes,     { prefix: '/orgs' })
  await app.register(projectsRoutes, { prefix: '/orgs/:slug/projects' })
  await app.register(issuesRoutes,   { prefix: '/orgs/:slug/projects/:projectId/issues' })
  await app.register(sprintsRoutes,  { prefix: '/orgs/:slug/projects/:projectId/sprints' })

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

    // 5 — Create an issue to use in sprint-issue tests
    const issueRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Sprint test issue', statusId: defaultStatusId })
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
      expect(res.body.status).toBe('completed')
      expect(res.body.id).toBe(sprintId)
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
  describe('POST /sprints/:sprintId/issues/:issueId', () => {

    it('should add an issue to the sprint and update its sprintId in DB', async () => {
      // sprint2Id is still planned — use it for add/remove tests
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/sprints/${sprint2Id}/issues/${issueId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(204)

      const [row] = await db
        .select({ sprintId: issues.sprintId })
        .from(issues)
        .where(eq(issues.id, issueId))
        .limit(1)

      expect(row?.sprintId).toBe(sprint2Id)
    })

    it('should reject adding an issue to a completed sprint — 400', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/sprints/${sprintId}/issues/${issueId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('SPRINT_COMPLETED')
    })
  })

  // ===========================================================================
  describe('DELETE /sprints/:sprintId/issues/:issueId', () => {

    it('should remove issue from sprint and set its sprintId to null', async () => {
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/sprints/${sprint2Id}/issues/${issueId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(204)

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

    it('should delete a planned sprint and move its issues to the backlog', async () => {
      // Re-add issue to sprint2 so we can verify backlog move on delete
      await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/sprints/${sprint2Id}/issues/${issueId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

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
    })
  })
})
