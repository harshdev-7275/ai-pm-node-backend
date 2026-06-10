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
import { commentsRoutes } from '../comments.routes.js'
import { categoriesRoutes } from '../../categories/categories.routes.js'
import { env } from '../../../config/env.js'
import { db } from '../../../db/index.js'
import { issueComments, issueStatuses } from '../../../db/schema.js'
import { and, eq, isNotNull } from 'drizzle-orm'

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
  await app.register(commentsRoutes, { prefix: '/orgs/:slug/projects/:projectId/issues' })
  await app.register(categoriesRoutes, { prefix: '/orgs/:slug/projects/:projectId/categories' })

  await app.ready()
  return app
}

// =============================================================================
// TESTS
// =============================================================================

describe('Comments API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  let ownerToken:    string   // creates the issue and comments
  let memberToken:   string   // org member — not the comment author
  let outsiderToken: string   // never joins the org

  let orgSlug:   string
  let projectId: string
  let issueId:   string
  let commentId: string   // created in POST tests, reused throughout

  const ts            = Date.now()
  const ownerEmail    = `comment_owner_${ts}@test.com`
  const memberEmail   = `comment_member_${ts}@test.com`
  const outsiderEmail = `comment_outsider_${ts}@test.com`

  beforeAll(async () => {
    app = await buildTestApp()

    // 1 — Register owner
    const ownerRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Comment Owner', email: ownerEmail, password: 'password123' })
    ownerToken = ownerRes.body.accessToken

    // 2 — Create org
    const orgRes = await supertest(app.server)
      .post('/orgs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Comments Test Org' })
    orgSlug = orgRes.body.slug

    // 3 — Create project (seeds default statuses)
    const projectRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Comments Project', key: `CMT${ts.toString().slice(-4)}` })
    projectId = projectRes.body.id

    // 4 — Grab the seeded default status from DB
    const statuses = await db
      .select()
      .from(issueStatuses)
      .where(eq(issueStatuses.projectId, projectId))
      .orderBy(issueStatuses.position)
    const defaultStatusId = statuses[0]!.id

    // 4b — Create a category — categoryId is required on every issue
    const categoryRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects/${projectId}/categories`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'General' })
    const categoryId = categoryRes.body.id

    // 5 — Create the shared issue for all comment tests
    const issueRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Comment test issue', statusId: defaultStatusId, categoryId })
    issueId = issueRes.body.id

    // 6 — Register a second user, invite them to the org, and accept
    const memberRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Comment Member', email: memberEmail, password: 'password123' })
    memberToken = memberRes.body.accessToken

    const inviteRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: memberEmail, role: 'member' })
    const inviteToken = inviteRes.body.token

    await supertest(app.server)
      .post('/orgs/invite/accept')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ token: inviteToken })

    // 6b — Add the member to the project so they pass project-access checks.
    // They are still NOT the comment author — used by the author-only 403 tests.
    await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: memberRes.body.user.id, role: 'member' })

    // 7 — Register outsider (never joins the org)
    const outsiderRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Comment Outsider', email: outsiderEmail, password: 'password123' })
    outsiderToken = outsiderRes.body.accessToken
  }, 60000)

  afterAll(async () => {
    await app.close()
  }, 30000)

  // ===========================================================================
  describe('GET /:issueId/comments', () => {

    it('should return an empty array when the issue has no comments', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })

    it('should return comments after one is created', async () => {
      // Create a comment to populate the list
      await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ body: 'First comment' })

      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.length).toBeGreaterThanOrEqual(1)
      expect(res.body[0].body).toBe('First comment')
      expect(res.body[0].author).toBeDefined()
      expect(res.body[0].author.name).toBe('Comment Owner')
    })

    it('should reject non-members — 403', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/comments`)
        .set('Authorization', `Bearer ${outsiderToken}`)

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })
  })

  // ===========================================================================
  describe('POST /:issueId/comments', () => {

    it('should create a comment and return 201 with body and author', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ body: 'New comment from owner' })

      expect(res.status).toBe(201)
      expect(res.body.body).toBe('New comment from owner')
      expect(res.body.isEdited).toBe(false)
      expect(res.body.parentId).toBeNull()
      expect(res.body.author).toBeDefined()
      expect(res.body.author.name).toBe('Comment Owner')
      expect(res.body.id).toBeDefined()

      commentId = res.body.id   // save for PATCH/DELETE tests
    })

    it('should reject empty body — 400', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ body: '' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
    })

    it('should reject non-members — 403', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/comments`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ body: 'Sneaky comment' })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })
  })

  // ===========================================================================
  describe('PATCH /:issueId/comments/:commentId', () => {

    it('should update the comment body and set isEdited to true', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ body: 'Edited comment body' })

      expect(res.status).toBe(200)
      expect(res.body.body).toBe('Edited comment body')
      expect(res.body.isEdited).toBe(true)
    })

    it('should reject if user is not the author — 403', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ body: 'Hijacked edit' })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('COMMENT_FORBIDDEN')
    })

    it('should reject empty body — 400', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ body: '' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
    })
  })

  // ===========================================================================
  describe('DELETE /:issueId/comments/:commentId', () => {

    it('should reject if user is not the author — 403', async () => {
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${memberToken}`)

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('COMMENT_FORBIDDEN')
    })

    it('should soft delete — body becomes [deleted] and deletedAt is set in DB', async () => {
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.message).toBe('Comment deleted')

      // Confirm the row is excluded from the list
      const listRes = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(listRes.body.some((c: { id: string }) => c.id === commentId)).toBe(false)

      // Confirm deletedAt is set in the DB and body is replaced
      const [row] = await db
        .select({ body: issueComments.body, deletedAt: issueComments.deletedAt })
        .from(issueComments)
        .where(and(eq(issueComments.id, commentId), isNotNull(issueComments.deletedAt)))
        .limit(1)

      expect(row).toBeDefined()
      expect(row?.body).toBe('[deleted]')
      expect(row?.deletedAt).not.toBeNull()
    })
  })
})
