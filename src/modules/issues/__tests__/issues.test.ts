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
import { categoriesRoutes } from '../../categories/categories.routes.js'
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
  await app.register(categoriesRoutes, { prefix: '/orgs/:slug/projects/:projectId/categories' })

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
  let doneStatusId:    string   // "Done" — category 'done', drives completedAt
  let categoryId:    string     // required on every issue since the category restructure
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
    doneStatusId    = statuses[3]!.id   // Done (position 4, category 'done')

    // 5 — Create a category — categoryId is required on every issue
    const categoryRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects/${projectId}/categories`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'General' })
    categoryId = categoryRes.body.id

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
        .send({ title: 'First issue', statusId: defaultStatusId, categoryId })

      expect(res.status).toBe(201)
      expect(res.body.title).toBe('First issue')
      expect(res.body.number).toBe(1)
      expect(res.body.categoryId).toBe(categoryId)
      expect(res.body.type).toBe('task')
      expect(res.body.priority).toBe('medium')
      expect(res.body.id).toBeDefined()

      issueId = res.body.id  // save for subsequent tests
    })

    it('should auto-increment issue number — second issue = 2', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Second issue', statusId: defaultStatusId, categoryId, type: 'bug', priority: 'high' })

      expect(res.status).toBe(201)
      expect(res.body.number).toBe(2)
      expect(res.body.type).toBe('bug')
      expect(res.body.priority).toBe('high')
    })

    it('should reject missing title — 400', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ statusId: defaultStatusId, categoryId })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
    })

    it('should reject non-members — 403', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ title: 'Ghost issue', statusId: defaultStatusId, categoryId })

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
        .send({ title: 'To be deleted', statusId: defaultStatusId, categoryId })

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
  describe('status category drives startedAt / completedAt', () => {
    let tsIssueId: string

    it('a fresh issue in a todo status has no startedAt/completedAt', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Timestamp issue', statusId: defaultStatusId, categoryId })

      expect(res.status).toBe(201)
      tsIssueId = res.body.id
      expect(res.body.startedAt).toBeNull()
      expect(res.body.completedAt).toBeNull()
    })

    it('sets startedAt when moved to an in_progress status', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${tsIssueId}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ statusId: secondStatusId })

      expect(res.status).toBe(200)
      expect(res.body.startedAt).not.toBeNull()
      expect(res.body.completedAt).toBeNull()
    })

    it('sets completedAt when moved to a done status', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${tsIssueId}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ statusId: doneStatusId })

      expect(res.status).toBe(200)
      expect(res.body.completedAt).not.toBeNull()
      expect(res.body.startedAt).not.toBeNull()
    })

    it('clears completedAt when moved back out of done (startedAt preserved)', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${tsIssueId}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ statusId: defaultStatusId })

      expect(res.status).toBe(200)
      expect(res.body.completedAt).toBeNull()
      expect(res.body.startedAt).not.toBeNull()
    })

    it('rejects a statusId that does not belong to the project — 400', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${tsIssueId}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ statusId: '00000000-0000-0000-0000-000000000000' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('STATUS_NOT_FOUND')
    })
  })

  // ===========================================================================
  describe('parentId validation — subtask hierarchy rules', () => {
    let parentTaskId: string   // a plain task — valid parent for subtasks

    const createIssue = (payload: Record<string, unknown>) =>
      supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ statusId: defaultStatusId, categoryId, ...payload })

    it('creates a subtask under a task parent', async () => {
      const parentRes = await createIssue({ title: 'Parent task', type: 'task' })
      expect(parentRes.status).toBe(201)
      parentTaskId = parentRes.body.id

      const res = await createIssue({ title: 'Child subtask', type: 'subtask', parentId: parentTaskId })

      expect(res.status).toBe(201)
      expect(res.body.parentId).toBe(parentTaskId)
    })

    it('rejects a parent that does not exist — 400 PARENT_NOT_FOUND', async () => {
      const res = await createIssue({
        title: 'Orphan subtask',
        type:  'subtask',
        parentId: '00000000-0000-0000-0000-000000000000',
      })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('PARENT_NOT_FOUND')
    })

    it('rejects a parent from another project — 400 PARENT_NOT_FOUND', async () => {
      // Build a second project with its own category/status/issue
      const proj2 = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Other Project', key: `OTH${ts.toString().slice(-4)}` })
      const p2Statuses = await db
        .select()
        .from(issueStatuses)
        .where(eq(issueStatuses.projectId, proj2.body.id))
        .orderBy(issueStatuses.position)
      const p2Category = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${proj2.body.id}/categories`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Other General' })
      const foreignParent = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${proj2.body.id}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title:      'Foreign parent',
          statusId:   p2Statuses[0]!.id,
          categoryId: p2Category.body.id,
        })

      const res = await createIssue({
        title: 'Cross-project subtask',
        type:  'subtask',
        parentId: foreignParent.body.id,
      })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('PARENT_NOT_FOUND')
    })

    it('rejects parentId on a non-subtask issue — 400 PARENT_NOT_ALLOWED', async () => {
      const res = await createIssue({ title: 'Task with parent', type: 'task', parentId: parentTaskId })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('PARENT_NOT_ALLOWED')
    })

    it('rejects a subtask as parent (no nesting) — 400 PARENT_IS_SUBTASK', async () => {
      const subtaskRes = await createIssue({ title: 'Existing subtask', type: 'subtask', parentId: parentTaskId })

      const res = await createIssue({
        title: 'Nested subtask',
        type:  'subtask',
        parentId: subtaskRes.body.id,
      })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('PARENT_IS_SUBTASK')
    })

    it('applies the same rules on update — 400 PARENT_NOT_ALLOWED', async () => {
      const taskRes = await createIssue({ title: 'Plain task', type: 'task' })

      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${taskRes.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ parentId: parentTaskId })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('PARENT_NOT_ALLOWED')
    })

    it('soft-deleting a parent also soft-deletes its subtasks', async () => {
      const parentRes = await createIssue({ title: 'Doomed parent', type: 'task' })
      const childRes  = await createIssue({ title: 'Doomed child', type: 'subtask', parentId: parentRes.body.id })

      const delRes = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/issues/${parentRes.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
      expect(delRes.status).toBe(200)

      const listRes = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(listRes.body.some((i: { id: string }) => i.id === childRes.body.id)).toBe(false)
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
