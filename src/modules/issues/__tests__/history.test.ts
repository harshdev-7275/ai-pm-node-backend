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
  await app.register(orgsRoutes,     { prefix: '/orgs' })
  await app.register(projectsRoutes, { prefix: '/orgs/:slug/projects' })
  await app.register(issuesRoutes,   { prefix: '/orgs/:slug/projects/:projectId/issues' })

  await app.ready()
  return app
}

// =============================================================================
// TESTS
// =============================================================================

describe('Issue History API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  let ownerToken:    string
  let outsiderToken: string
  let orgSlug:       string
  let projectId:     string
  let issueId:       string      // shared issue — fresh per describe via the one created in beforeAll
  let freshIssueId:  string      // second issue used only for the empty-history test

  const ts            = Date.now()
  const ownerEmail    = `history_owner_${ts}@test.com`
  const outsiderEmail = `history_outsider_${ts}@test.com`

  beforeAll(async () => {
    app = await buildTestApp()

    // 1 — Register owner
    const ownerRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'History Owner', email: ownerEmail, password: 'password123' })
    ownerToken = ownerRes.body.accessToken

    // 2 — Create org
    const orgRes = await supertest(app.server)
      .post('/orgs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'History Test Org' })
    orgSlug = orgRes.body.slug

    // 3 — Create project (seeds default statuses)
    const projectRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'History Project', key: `HST${ts.toString().slice(-4)}` })
    projectId = projectRes.body.id

    // 4 — Grab default status from DB
    const statuses = await db
      .select()
      .from(issueStatuses)
      .where(eq(issueStatuses.projectId, projectId))
      .orderBy(issueStatuses.position)
    const defaultStatusId = statuses[0]!.id

    // 5 — Create two issues:
    //     freshIssueId — never updated, used for the empty-history test
    //     issueId      — updated in subsequent tests to populate history
    const freshRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Fresh issue — never updated', statusId: defaultStatusId })
    freshIssueId = freshRes.body.id

    const issueRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'History test issue', statusId: defaultStatusId })
    issueId = issueRes.body.id

    // 6 — Register outsider (never joins the org)
    const outsiderRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'History Outsider', email: outsiderEmail, password: 'password123' })
    outsiderToken = outsiderRes.body.accessToken
  }, 60000)

  afterAll(async () => {
    await app.close()
  }, 30000)

  // ===========================================================================
  describe('GET /:issueId/history', () => {

    it('should return an empty array for a fresh issue with no changes', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues/${freshIssueId}/history`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })

    it('should return a history entry after the title is updated', async () => {
      await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Updated title' })

      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/history`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.length).toBeGreaterThanOrEqual(1)

      const titleEntry = res.body.find((e: { fieldChanged: string }) => e.fieldChanged === 'title')
      expect(titleEntry).toBeDefined()
      expect(titleEntry.oldValue).toBe('History test issue')
      expect(titleEntry.newValue).toBe('Updated title')
    })

    it('each entry should include changedBy with id, name and avatarUrl', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/history`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.length).toBeGreaterThanOrEqual(1)

      const entry = res.body[0]
      expect(entry.changedBy).toBeDefined()
      expect(entry.changedBy.id).toBeDefined()
      expect(entry.changedBy.name).toBe('History Owner')
      expect('avatarUrl' in entry.changedBy).toBe(true)
    })

    it('should be ordered newest first — second update appears before first', async () => {
      // First update was already made above (title → 'Updated title')
      // Make a second update
      await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Second update' })

      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/history`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)

      const titleEntries = res.body.filter((e: { fieldChanged: string }) => e.fieldChanged === 'title')
      expect(titleEntries.length).toBeGreaterThanOrEqual(2)

      // Newest first — 'Second update' should appear before 'Updated title'
      const firstIdx  = titleEntries.findIndex((e: { newValue: string }) => e.newValue === 'Second update')
      const secondIdx = titleEntries.findIndex((e: { newValue: string }) => e.newValue === 'Updated title')
      expect(firstIdx).toBeLessThan(secondIdx)
    })

    it('should reject non-members — 403', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/history`)
        .set('Authorization', `Bearer ${outsiderToken}`)

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })
  })
})
