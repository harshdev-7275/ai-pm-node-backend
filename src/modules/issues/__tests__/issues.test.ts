import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import supertest from 'supertest'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import { authRoutes } from '../../auth/auth.routes.js'
import { orgsRoutes } from '../../orgs/orgs.routes.js'
import { projectsRoutes } from '../../projects/projects.routes.js'
import { issuesRoutes } from '../issues.routes.js'
import { env } from '../../../config/env.js'
import { db } from '../../../db/index.js'
import { issueStatuses, issues } from '../../../db/schema.js'
import { and, eq } from 'drizzle-orm'

// =============================================================================
// TEST APP SETUP
// =============================================================================

const buildTestApp = async () => {
  const app = Fastify()

  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: env.JWT_SECRET })
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

  await app.register(authRoutes)
  await app.register(orgsRoutes, { prefix: '/orgs' })
  await app.register(projectsRoutes, { prefix: '/orgs/:slug/projects' })
  await app.register(issuesRoutes, { prefix: '/orgs/:slug/projects/:projectId/issues' })

  await app.ready()
  return app
}

// =============================================================================
// TESTS
// =============================================================================

describe('Issues API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  let ownerToken:    string
  let outsiderToken: string
  let orgSlug:       string
  let projectId:     string
  let defaultStatusId: string   // "Todo" status seeded on project creation
  let secondStatusId:  string   // "In Progress" — used for status update tests
  let issueId:       string     // created in POST tests, used throughout

  const ts           = Date.now()
  const ownerEmail   = `issues_owner_${ts}@test.com`
  const outsiderEmail = `issues_outsider_${ts}@test.com`
  const PROJECT_KEY  = `ISS${ts.toString().slice(-4)}`

  beforeAll(async () => {
    app = await buildTestApp()

    // 1 — Register owner
    const ownerRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Issue Owner', email: ownerEmail, password: 'password123' })
    ownerToken = ownerRes.body.accessToken

    // 2 — Create org
    const orgRes = await supertest(app.server)
      .post('/orgs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Issues Test Org' })
    orgSlug = orgRes.body.slug

    // 3 — Create project (seeds 5 default statuses)
    const projectRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Issues Project', key: PROJECT_KEY })
    projectId = projectRes.body.id

    // 4 — Grab the seeded statuses directly from the DB
    const statuses = await db
      .select()
      .from(issueStatuses)
      .where(eq(issueStatuses.projectId, projectId))
      .orderBy(issueStatuses.position)

    defaultStatusId = statuses[0]!.id   // Todo (position 1, isDefault)
    secondStatusId  = statuses[1]!.id   // In Progress (position 2)

    // 5 — Register outsider (never joins the org)
    const outsiderRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Outsider', email: outsiderEmail, password: 'password123' })
    outsiderToken = outsiderRes.body.accessToken
  }, 60000)

  afterAll(async () => {
    await app.close()
  }, 30000)

  // ===========================================================================
  describe('GET /orgs/:slug/projects/:projectId/issues/statuses', () => {

    it('should return 5 default statuses seeded on project creation', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues/statuses`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(5)
    })

    it('should be ordered by position — Todo first, Cancelled last', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues/statuses`)
        .set('Authorization', `Bearer ${ownerToken}`)

      const names = res.body.map((s: { name: string }) => s.name)
      expect(names[0]).toBe('Todo')
      expect(names[4]).toBe('Cancelled')
    })

    it('should reject non-members — 403', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues/statuses`)
        .set('Authorization', `Bearer ${outsiderToken}`)

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })
  })

  // ===========================================================================
  describe('POST /orgs/:slug/projects/:projectId/issues', () => {

    it('should create an issue and return 201 with number, title, type, priority', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'First issue', statusId: defaultStatusId })

      expect(res.status).toBe(201)
      expect(res.body.title).toBe('First issue')
      expect(res.body.number).toBe(1)
      expect(res.body.type).toBe('task')
      expect(res.body.priority).toBe('medium')
      expect(res.body.id).toBeDefined()

      issueId = res.body.id  // save for subsequent tests
    })

    it('should auto-increment issue number — second issue = 2', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Second issue', statusId: defaultStatusId, type: 'bug', priority: 'high' })

      expect(res.status).toBe(201)
      expect(res.body.number).toBe(2)
      expect(res.body.type).toBe('bug')
      expect(res.body.priority).toBe('high')
    })

    it('should reject missing title — 400', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ statusId: defaultStatusId })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
    })

    it('should reject non-members — 403', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ title: 'Ghost issue', statusId: defaultStatusId })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })
  })

  // ===========================================================================
  describe('GET /orgs/:slug/projects/:projectId/issues', () => {

    it('should return the list of active issues for the project', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body.length).toBeGreaterThanOrEqual(2)
      expect(res.body.some((i: { id: string }) => i.id === issueId)).toBe(true)
    })

    it('should not include soft-deleted issues', async () => {
      // Create a throwaway issue and soft-delete it
      const createRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'To be deleted', statusId: defaultStatusId })

      const deletedId = createRes.body.id

      await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/issues/${deletedId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      const listRes = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(listRes.body.some((i: { id: string }) => i.id === deletedId)).toBe(false)
    })
  })

  // ===========================================================================
  describe('GET /orgs/:slug/projects/:projectId/issues/:issueId', () => {

    it('should return full issue detail with status, assignee and reporter joined', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(issueId)
      expect(res.body.title).toBe('First issue')
      expect(res.body.status).toBeDefined()
      expect(res.body.status.name).toBe('Todo')
      expect(res.body.reporter).toBeDefined()
      expect(res.body.reporter.email).toBe(ownerEmail)
      expect(res.body.assignee).toBeNull()
    })

    it('should return 404 for a non-existent issue', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('ISSUE_NOT_FOUND')
    })
  })

  // ===========================================================================
  describe('PATCH /orgs/:slug/projects/:projectId/issues/:issueId', () => {

    it('should update the title successfully', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Updated title' })

      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Updated title')
    })

    it('should update the assignee successfully', async () => {
      // The owner's userId is the reporter — assign the issue to themselves
      const meRes = await supertest(app.server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${ownerToken}`)

      const ownerId = meRes.body.id

      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ assigneeId: ownerId })

      expect(res.status).toBe(200)
      expect(res.body.assigneeId).toBe(ownerId)
    })

    it('should clear the assignee when set to null', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ assigneeId: null })

      expect(res.status).toBe(200)
      expect(res.body.assigneeId).toBeNull()
    })
  })

  // ===========================================================================
  describe('PATCH /orgs/:slug/projects/:projectId/issues/:issueId/status', () => {

    it('should update the status — simulates board drag-and-drop', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ statusId: secondStatusId })

      expect(res.status).toBe(200)
      expect(res.body.statusId).toBe(secondStatusId)
    })

    it('should reject an invalid (non-uuid) statusId — 400', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ statusId: 'not-a-uuid' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
    })
  })

  // ===========================================================================
  describe('DELETE /orgs/:slug/projects/:projectId/issues/:issueId', () => {

    it('should reject non-members — 403', async () => {
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })

    it('should soft-delete — issue disappears from list but row stays in DB', async () => {
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.message).toBe('Issue deleted')

      // Confirm absent from the list
      const listRes = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(listRes.body.some((i: { id: string }) => i.id === issueId)).toBe(false)

      // Confirm the DB row still exists with deletedAt set
      const [dbRow] = await db
        .select({ id: issues.id, deletedAt: issues.deletedAt })
        .from(issues)
        .where(and(eq(issues.id, issueId)))
        .limit(1)

      expect(dbRow?.deletedAt).not.toBeNull()
    })
  })
})
