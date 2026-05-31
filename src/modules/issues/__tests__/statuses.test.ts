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
import { statusesRoutes } from '../statuses.routes.js'
import { env } from '../../../config/env.js'
import { db } from '../../../db/index.js'
import { issueStatuses, organizationMembers, projects } from '../../../db/schema.js'
import { eq, and } from 'drizzle-orm'

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
  // Issues needed for the "status has issues" delete safety check
  await app.register(issuesRoutes, { prefix: '/orgs/:slug/projects/:projectId/issues' })
  await app.register(statusesRoutes, { prefix: '/orgs/:slug/projects/:projectId/statuses' })

  await app.ready()
  return app
}

// =============================================================================
// TESTS
// =============================================================================

describe('Statuses API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  let ownerToken:    string
  let memberToken:   string  // org member, NOT owner/admin/lead — must be denied write access
  let outsiderToken: string  // not in org at all

  let orgSlug:    string
  let projectId:  string

  let todoStatusId:       string  // isDefault: true — used in issue creation
  let inProgressStatusId: string  // safe to rename/recolor in PATCH tests

  const ts           = Date.now()
  const ownerEmail   = `stat_owner_${ts}@test.com`
  const memberEmail  = `stat_member_${ts}@test.com`
  const outsiderEmail = `stat_out_${ts}@test.com`
  const PROJECT_KEY  = `STA${ts.toString().slice(-3)}`

  beforeAll(async () => {
    app = await buildTestApp()

    // ── Register three users ──────────────────────────────────────────────────
    const ownerRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Stat Owner', email: ownerEmail, password: 'password123' })
    ownerToken = ownerRes.body.accessToken

    const memberRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Stat Member', email: memberEmail, password: 'password123' })
    memberToken = memberRes.body.accessToken

    const outsiderRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Stat Outsider', email: outsiderEmail, password: 'password123' })
    outsiderToken = outsiderRes.body.accessToken

    // ── Create org (owner gets org 'owner' role automatically) ────────────────
    const orgRes = await supertest(app.server)
      .post('/orgs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Statuses Test Org' })
    orgSlug = orgRes.body.slug

    // ── Add the plain member directly into the org as role='member' ───────────
    // (Bypasses the invite flow — acceptable in tests for speed)
    const memberPayload = app.jwt.decode(memberToken) as { userId: string }
    await db.insert(organizationMembers).values({
      orgId:  orgRes.body.id,
      userId: memberPayload.userId,
      role:   'member',
    })

    // ── Create project (seeds 5 default statuses) ────────────────────────────
    const projectRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Statuses Project', key: PROJECT_KEY })
    projectId = projectRes.body.id

    // ── Grab seeded statuses from DB ─────────────────────────────────────────
    const statuses = await db
      .select()
      .from(issueStatuses)
      .where(eq(issueStatuses.projectId, projectId))
      .orderBy(issueStatuses.position)

    todoStatusId       = statuses.find(s => s.name === 'Todo')!.id
    inProgressStatusId = statuses.find(s => s.name === 'In Progress')!.id
  }, 60_000)

  afterAll(async () => {
    await app.close()
  }, 30_000)

  // ===========================================================================
  // GET
  // ===========================================================================

  describe('GET /orgs/:slug/projects/:projectId/statuses', () => {

    it('returns 200 with 5 statuses ordered by position', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/statuses`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(5)
      expect(res.body[0].name).toBe('Todo')
      expect(res.body[4].name).toBe('Cancelled')
      expect(res.body[0]).toHaveProperty('isDefault', true)
      expect(res.body[0]).toHaveProperty('color')
      expect(res.body[0]).toHaveProperty('position', 1)
    })

    it('returns 401 without auth token', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/statuses`)
      expect(res.status).toBe(401)
    })

    it('returns 403 for non-org-member (outsider)', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/statuses`)
        .set('Authorization', `Bearer ${outsiderToken}`)
      expect(res.status).toBe(403)
    })

    it('org member can view statuses (read is open to all members)', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/statuses`)
        .set('Authorization', `Bearer ${memberToken}`)
      expect(res.status).toBe(200)
    })

  })

  // ===========================================================================
  // POST
  // ===========================================================================

  describe('POST /orgs/:slug/projects/:projectId/statuses', () => {

    it('creates a status as org owner — 201 with correct shape', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/statuses`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'QA Testing', color: '#8b5cf6' })

      expect(res.status).toBe(201)
      expect(res.body.name).toBe('QA Testing')
      expect(res.body.color).toBe('#8b5cf6')
      expect(res.body.position).toBe(6)   // auto-assigned after 5 seeded
      expect(res.body.projectId).toBe(projectId)
      expect(res.body.isDefault).toBe(false)
      expect(res.body.id).toBeDefined()
    })

    it('returns 400 for invalid hex color', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/statuses`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Bad', color: 'notacolor' })
      expect(res.status).toBe(400)
    })

    it('returns 400 for missing name', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/statuses`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ color: '#ff0000' })
      expect(res.status).toBe(400)
    })

    it('returns 403 for outsider', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/statuses`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ name: 'Ghost', color: '#000000' })
      expect(res.status).toBe(403)
    })

    it('returns 403 for plain org member (not owner/admin/lead)', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/statuses`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ name: 'Hack', color: '#ff0000' })
      expect(res.status).toBe(403)
    })

  })

  // ===========================================================================
  // PATCH
  // ===========================================================================

  describe('PATCH /orgs/:slug/projects/:projectId/statuses/:id', () => {

    it('renames a status — 200 with updated name', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/statuses/${inProgressStatusId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'In Development' })

      expect(res.status).toBe(200)
      expect(res.body.name).toBe('In Development')
      expect(res.body.id).toBe(inProgressStatusId)
    })

    it('recolors a status — 200 with updated color', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/statuses/${inProgressStatusId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ color: '#0ea5e9' })

      expect(res.status).toBe(200)
      expect(res.body.color).toBe('#0ea5e9')
    })

    it('returns 400 for invalid hex color in PATCH', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/statuses/${inProgressStatusId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ color: 'blue' })
      expect(res.status).toBe(400)
    })

    it('returns 404 for unknown status id', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/statuses/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Ghost' })
      expect(res.status).toBe(404)
    })

    it('returns 403 for outsider', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/statuses/${inProgressStatusId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ name: 'Hacked' })
      expect(res.status).toBe(403)
    })

    it('returns 403 for plain org member', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/statuses/${inProgressStatusId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ name: 'Hacked' })
      expect(res.status).toBe(403)
    })

  })

  // ===========================================================================
  // DELETE
  // ===========================================================================

  describe('DELETE /orgs/:slug/projects/:projectId/statuses/:id', () => {
    let deletableId: string  // "QA Testing" status created in POST tests — no issues

    // "Cancelled" is also safe to delete in this project (no issues assigned)
    beforeAll(async () => {
      const statuses = await db
        .select()
        .from(issueStatuses)
        .where(eq(issueStatuses.projectId, projectId))
        .orderBy(issueStatuses.position)
      // Pick the last status that is NOT the default (Todo) to use as deletable target
      deletableId = statuses.find(s => s.name === 'Cancelled')!.id
    })

    it('deletes a status with no issues — 200', async () => {
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/statuses/${deletableId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.message).toBeDefined()
    })

    it('returns 409 when issues are assigned to the status', async () => {
      // Create an issue assigned to todoStatusId, then try to delete that status
      const issueRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Blocking issue', statusId: todoStatusId })

      expect(issueRes.status).toBe(201)

      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/statuses/${todoStatusId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(409)
      expect(res.body.error).toBe('STATUS_HAS_ISSUES')
      expect(res.body.issueCount).toBeGreaterThan(0)
    })

    it('returns 400 when project has only one status remaining', async () => {
      // Spin up a fresh minimal project, delete statuses until 1 remains, then try
      const minProjRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Min Project', key: `MIN${ts.toString().slice(-3)}` })
      const minProjectId: string = minProjRes.body.id

      // Delete 4 of the 5 seeded statuses directly from DB so only 1 remains
      const minStatuses = await db
        .select()
        .from(issueStatuses)
        .where(eq(issueStatuses.projectId, minProjectId))
        .orderBy(issueStatuses.position)

      for (const s of minStatuses.slice(1)) {
        await db.delete(issueStatuses).where(eq(issueStatuses.id, s.id))
      }

      // Now try to delete the last one
      const lastId = minStatuses[0]!.id
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${minProjectId}/statuses/${lastId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('LAST_STATUS')
    })

    it('returns 404 for unknown status id', async () => {
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/statuses/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${ownerToken}`)
      expect(res.status).toBe(404)
    })

    it('returns 403 for plain org member', async () => {
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/statuses/${inProgressStatusId}`)
        .set('Authorization', `Bearer ${memberToken}`)
      expect(res.status).toBe(403)
    })

  })

})
