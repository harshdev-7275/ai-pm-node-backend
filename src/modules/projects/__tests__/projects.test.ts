import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import supertest from 'supertest'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import { authRoutes } from '../../auth/auth.routes.js'
import { orgsRoutes } from '../../orgs/orgs.routes.js'
import { projectsRoutes } from '../projects.routes.js'
import { issuesRoutes } from '../../issues/issues.routes.js'
import { categoriesRoutes } from '../../categories/categories.routes.js'
import { env } from '../../../config/env.js'
import { db } from '../../../db/index.js'
import { issueStatuses } from '../../../db/schema.js'
import { eq } from 'drizzle-orm'

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

describe('Projects API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  let ownerToken:   string
  let memberToken:  string
  let memberUserId: string
  let outsiderToken: string
  let orgSlug:    string
  let projectId:  string

  const ts           = Date.now()
  const ownerEmail   = `proj_owner_${ts}@test.com`
  const memberEmail  = `proj_member_${ts}@test.com`
  const outsiderEmail = `proj_outsider_${ts}@test.com`
  const PROJECT_KEY  = `TST${ts.toString().slice(-4)}`  // unique 7-char key per run

  beforeAll(async () => {
    app = await buildTestApp()

    // 1 — Register owner
    const ownerRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Project Owner', email: ownerEmail, password: 'password123' })
    ownerToken = ownerRes.body.accessToken

    // 2 — Create org
    const orgRes = await supertest(app.server)
      .post('/orgs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Project Test Org' })
    orgSlug = orgRes.body.slug

    // 3 — Register org member (not yet a project member)
    const memberRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Org Member', email: memberEmail, password: 'password123' })
    memberToken  = memberRes.body.accessToken
    memberUserId = memberRes.body.user.id

    // 4 — Invite member to org and accept
    const inviteRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: memberEmail, role: 'member' })
    await supertest(app.server)
      .post('/orgs/invite/accept')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ token: inviteRes.body.token })

    // 5 — Register outsider (never joins the org)
    const outsiderRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Outsider', email: outsiderEmail, password: 'password123' })
    outsiderToken = outsiderRes.body.accessToken

    // 6 — Create the main project
    const projectRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Main Project', key: PROJECT_KEY })
    projectId = projectRes.body.id
  }, 60000)

  afterAll(async () => {
    await app.close()
  }, 30000)

  // ===========================================================================
  describe('POST /orgs/:slug/projects', () => {

    it('should create a project and return 201 with name, key and id', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Secondary Project', key: `SEC${ts.toString().slice(-4)}` })

      expect(res.status).toBe(201)
      expect(res.body.name).toBe('Secondary Project')
      expect(res.body.key).toBeDefined()
      expect(res.body.id).toBeDefined()
      expect(res.body.isArchived).toBe(false)
    })

    it('should auto-seed 5 default issue statuses on creation', async () => {
      const statuses = await db
        .select()
        .from(issueStatuses)
        .where(eq(issueStatuses.projectId, projectId))

      expect(statuses).toHaveLength(5)

      const names = statuses.map(s => s.name)
      expect(names).toContain('Todo')
      expect(names).toContain('In Progress')
      expect(names).toContain('In Review')
      expect(names).toContain('Done')
      expect(names).toContain('Cancelled')

      const defaultStatus = statuses.find(s => s.isDefault)
      expect(defaultStatus?.name).toBe('Todo')
    })

    it('should reject if key already exists in the same org — 409', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Duplicate Key Project', key: PROJECT_KEY })

      expect(res.status).toBe(409)
      expect(res.body.error).toBe('KEY_TAKEN')
    })

    it('should reject if user is not an org member — 403', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ name: 'Ghost Project', key: 'GHOST' })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })

    it('should reject missing name or key — 400', async () => {
      const missingKey = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'No Key Project' })

      expect(missingKey.status).toBe(400)
      expect(missingKey.body.error).toBe('VALIDATION_ERROR')

      const missingName = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ key: 'NONAME' })

      expect(missingName.status).toBe(400)
      expect(missingName.body.error).toBe('VALIDATION_ERROR')
    })
  })

  // ===========================================================================
  describe('GET /orgs/:slug/projects', () => {

    it('should return list of active projects for the org', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body.some((p: { id: string }) => p.id === projectId)).toBe(true)
    })

    it('should not include archived projects', async () => {
      // Create a project and immediately archive it
      const createRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Archived Project', key: `ARC${ts.toString().slice(-4)}` })

      await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${createRes.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ isArchived: true })

      const listRes = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(listRes.status).toBe(200)
      expect(listRes.body.some((p: { id: string }) => p.id === createRes.body.id)).toBe(false)
    })
  })

  // ===========================================================================
  describe('GET /orgs/:slug/projects/:projectId', () => {

    it('should return project detail with members array', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(projectId)
      expect(res.body.name).toBe('Main Project')
      expect(Array.isArray(res.body.members)).toBe(true)
      expect(res.body.members.length).toBeGreaterThanOrEqual(1)
    })

    it('should return 404 for a non-existent project', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('PROJECT_NOT_FOUND')
    })
  })

  // ===========================================================================
  describe('PATCH /orgs/:slug/projects/:projectId', () => {

    it('should update project name successfully', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Main Project Renamed' })

      expect(res.status).toBe(200)
      expect(res.body.name).toBe('Main Project Renamed')
    })

    it('should archive a project when isArchived is set to true', async () => {
      // Create a dedicated project to archive so the main project stays active
      const createRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'To Archive', key: `ARX${ts.toString().slice(-4)}` })

      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${createRes.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ isArchived: true })

      expect(res.status).toBe(200)
      expect(res.body.isArchived).toBe(true)
    })

    it('should reject if user is not lead, admin or owner — 403', async () => {
      // memberUser is an org member but not a project lead
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ name: 'Hacked Name' })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })
  })

  // ===========================================================================
  describe('POST /orgs/:slug/projects/:projectId/members', () => {

    it('should reject if requesting user cannot manage members — 403', async () => {
      // memberUser: org member, not a project member at all → cannot manage
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ userId: memberUserId, role: 'member' })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })

    it('should add a new member to the project', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: memberUserId, role: 'member' })

      expect(res.status).toBe(201)
      expect(res.body.userId).toBe(memberUserId)
      expect(res.body.role).toBe('member')
    })

    it('should reject duplicate member — 409', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: memberUserId, role: 'member' })

      expect(res.status).toBe(409)
      expect(res.body.error).toBe('ALREADY_PROJECT_MEMBER')
    })
  })

  // ===========================================================================
  describe('PATCH /orgs/:slug/projects/:projectId/members/:userId', () => {

    it('should reject if requesting user cannot manage members — 403', async () => {
      // memberUser is a project 'member' — not lead, not org admin/owner
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/members/${memberUserId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ role: 'viewer' })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })

    it('should update a project member role successfully', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/members/${memberUserId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'viewer' })

      expect(res.status).toBe(200)
      expect(res.body.message).toBe('Member role updated')
    })
  })

  // ===========================================================================
  describe('DELETE /orgs/:slug/projects/:projectId/members/:userId', () => {

    it('should reject if requesting user cannot manage members — 403', async () => {
      // memberUser is now a project 'viewer' — still cannot manage
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/members/${memberUserId}`)
        .set('Authorization', `Bearer ${memberToken}`)

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })

    it('should remove a project member successfully', async () => {
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/members/${memberUserId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.message).toBe('Member removed from project')
    })
  })

  // ===========================================================================
  describe('GET /orgs/:slug/projects — member visibility filter', () => {
    // At this point in the test run the member has been removed from projectId,
    // so they are not in any project.

    let filteredProjectId: string

    it('org member sees no projects when not added to any', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${memberToken}`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body).toHaveLength(0)
    })

    it('org member only sees projects they are explicitly added to', async () => {
      // Create a project the member is not yet part of
      const createRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Filter Test Project', key: `FLT${ts.toString().slice(-4)}` })
      filteredProjectId = createRes.body.id

      // Member cannot see it yet
      const beforeRes = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${memberToken}`)
      expect(beforeRes.body.some((p: { id: string }) => p.id === filteredProjectId)).toBe(false)

      // Add member to that project
      await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${filteredProjectId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: memberUserId, role: 'member' })

      // Member now sees it but NOT the projects they are not in
      const afterRes = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${memberToken}`)
      expect(afterRes.body.some((p: { id: string }) => p.id === filteredProjectId)).toBe(true)
      expect(afterRes.body.some((p: { id: string }) => p.id === projectId)).toBe(false)
    })

    it('org owner still sees all active projects regardless of project membership', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.some((p: { id: string }) => p.id === projectId)).toBe(true)
      expect(res.body.some((p: { id: string }) => p.id === filteredProjectId)).toBe(true)
    })
  })

  // ===========================================================================
  describe('GET /orgs/:slug/projects — stats', () => {

    it('should return stats with todo, inProgress, done, and total counts', async () => {
      // Fetch statuses for the main project
      const statusesRes = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues/statuses`)
        .set('Authorization', `Bearer ${ownerToken}`)
      const todoStatus = statusesRes.body.find((s: { category: string }) => s.category === 'todo')
      const inProgressStatus = statusesRes.body.find((s: { category: string }) => s.category === 'in_progress')
      const doneStatus = statusesRes.body.find((s: { category: string }) => s.category === 'done')

      // Fetch categories for the main project
      const catsRes = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/categories`)
        .set('Authorization', `Bearer ${ownerToken}`)
      let categoryId = catsRes.body[0]?.id

      // Create a category if none exist
      if (!categoryId) {
        const catRes = await supertest(app.server)
          .post(`/orgs/${orgSlug}/projects/${projectId}/categories`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ name: 'General', color: '#6366f1' })
        categoryId = catRes.body.id
      }

      // Create 2 todo issues, 1 in_progress, 1 done
      await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Todo 1', categoryId, statusId: todoStatus.id })
      await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Todo 2', categoryId, statusId: todoStatus.id })
      await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Active 1', categoryId, statusId: inProgressStatus.id })
      await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Done 1', categoryId, statusId: doneStatus.id })

      // Now list projects and verify stats
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      const project = res.body.find((p: { id: string }) => p.id === projectId)
      expect(project).toBeDefined()
      expect(project.stats).toBeDefined()
      expect(project.stats.todo).toBe(2)
      expect(project.stats.inProgress).toBe(1)
      expect(project.stats.done).toBe(1)
      expect(project.stats.total).toBe(4)
    })

    it('should return zero stats for a project with no issues', async () => {
      // Create a fresh project with no issues
      const createRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Empty Stats Project', key: `EST${ts.toString().slice(-4)}` })

      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)

      const project = res.body.find((p: { id: string }) => p.id === createRes.body.id)
      expect(project).toBeDefined()
      expect(project.stats).toEqual({ todo: 0, inProgress: 0, done: 0, total: 0 })
    })
  })
})
