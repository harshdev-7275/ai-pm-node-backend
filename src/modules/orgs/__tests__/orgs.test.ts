import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import supertest from 'supertest'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import { authRoutes } from '../../auth/auth.routes.js'
import { orgsRoutes } from '../orgs.routes.js'
import { env } from '../../../config/env.js'
import { db } from '../../../db/index.js'
import { invitations } from '../../../db/schema.js'

// =============================================================================
// TEST APP SETUP — minimal, no Swagger/Helmet to keep tests fast and isolated
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

  await app.ready()
  return app
}

// =============================================================================
// TESTS
// =============================================================================

describe('Orgs API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  // Shared state across describes — set progressively
  let ownerToken:  string
  let ownerUserId: string
  let memberToken:  string
  let memberUserId: string
  let outsiderToken: string
  let orgId:   string
  let orgSlug: string

  const ts            = Date.now()
  const ownerEmail    = `owner_${ts}@test.com`
  const memberEmail   = `member_${ts}@test.com`
  const outsiderEmail = `outsider_${ts}@test.com`

  beforeAll(async () => {
    app = await buildTestApp()

    // 1 — Register owner
    const ownerRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Org Owner', email: ownerEmail, password: 'password123' })
    ownerToken  = ownerRes.body.accessToken
    ownerUserId = ownerRes.body.user.id

    // 2 — Create org (slug auto-generated from "Test Org")
    const orgRes = await supertest(app.server)
      .post('/orgs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Test Org' })
    orgId   = orgRes.body.id
    orgSlug = orgRes.body.slug

    // 3 — Register member user
    const memberRes = await supertest(app.server)
      .post('/auth/register')
      .send({ name: 'Org Member', email: memberEmail, password: 'password123' })
    memberToken  = memberRes.body.accessToken
    memberUserId = memberRes.body.user.id

    // 4 — Owner invites member
    const inviteRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: memberEmail, role: 'member' })

    // 5 — Member accepts invitation → now an active member with role 'member'
    await supertest(app.server)
      .post('/orgs/invite/accept')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ token: inviteRes.body.token })

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
  describe('POST /orgs', () => {

    it('should create an org and auto-generate slug from name', async () => {
      const res = await supertest(app.server)
        .post('/orgs')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Acme Healthcare' })

      expect(res.status).toBe(201)
      expect(res.body.name).toBe('Acme Healthcare')
      expect(res.body.slug).toMatch(/^acme-healthcare/)
      expect(res.body.plan).toBe('starter')
      expect(res.body.id).toBeDefined()
    })

    it('should reject unauthenticated request — 401', async () => {
      const res = await supertest(app.server)
        .post('/orgs')
        .send({ name: 'Ghost Org' })

      expect(res.status).toBe(401)
    })

    it('should reject missing name — 400', async () => {
      const res = await supertest(app.server)
        .post('/orgs')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
    })
  })

  // ===========================================================================
  describe('GET /orgs/me', () => {

    it('should return orgs the user belongs to', async () => {
      const res = await supertest(app.server)
        .get('/orgs/me')
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body.length).toBeGreaterThanOrEqual(1)
      expect(res.body.some((o: { slug: string }) => o.slug === orgSlug)).toBe(true)
    })

    it('should return empty array for user with no orgs', async () => {
      const freshRes = await supertest(app.server)
        .post('/auth/register')
        .send({ name: 'Fresh User', email: `fresh_${ts}@test.com`, password: 'password123' })

      const res = await supertest(app.server)
        .get('/orgs/me')
        .set('Authorization', `Bearer ${freshRes.body.accessToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })

    it('should reject unauthenticated request — 401', async () => {
      const res = await supertest(app.server).get('/orgs/me')

      expect(res.status).toBe(401)
    })
  })

  // ===========================================================================
  describe('GET /orgs/:slug', () => {

    it('should return org details for an active member', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.slug).toBe(orgSlug)
      expect(res.body.name).toBe('Test Org')
      expect(Array.isArray(res.body.members)).toBe(true)
      expect(res.body.members.length).toBeGreaterThanOrEqual(1)
    })

    it('should return 403 if user is not a member', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}`)
        .set('Authorization', `Bearer ${outsiderToken}`)

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })

    it('should return 404 if org does not exist', async () => {
      const res = await supertest(app.server)
        .get('/orgs/this-org-does-not-exist')
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('ORG_NOT_FOUND')
    })
  })

  // ===========================================================================
  describe('POST /orgs/:slug/invite', () => {

    it('should create an invitation and return token, email and expiry', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: `invite_target_${ts}@test.com`, role: 'member' })

      expect(res.status).toBe(201)
      expect(res.body.email).toBe(`invite_target_${ts}@test.com`)
      expect(res.body.token).toBeDefined()
      expect(res.body.expiresAt).toBeDefined()
      expect(res.body.role).toBe('member')
    })

    it('should return 409 if email is already an active member', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: memberEmail, role: 'member' })

      expect(res.status).toBe(409)
      expect(res.body.error).toBe('ALREADY_MEMBER')
    })

    it('should return 403 if requesting user is a member (not owner/admin)', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/invite`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ email: `someone_${ts}@test.com`, role: 'member' })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })
  })

  // ===========================================================================
  describe('POST /orgs/invite/accept', () => {

    it('should accept a valid invitation and add user to org', async () => {
      // Register a brand-new user to accept an invite
      const newUserRes = await supertest(app.server)
        .post('/auth/register')
        .send({ name: 'New Invitee', email: `invitee_${ts}@test.com`, password: 'password123' })

      const inviteRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: `invitee_${ts}@test.com`, role: 'member' })

      const token = inviteRes.body.token

      const acceptRes = await supertest(app.server)
        .post('/orgs/invite/accept')
        .set('Authorization', `Bearer ${newUserRes.body.accessToken}`)
        .send({ token })

      expect(acceptRes.status).toBe(200)
      expect(acceptRes.body.slug).toBe(orgSlug)
    })

    it('should return 410 for an already accepted invitation', async () => {
      // Create a fresh invite and accept it once
      const acceptOnceRes = await supertest(app.server)
        .post('/auth/register')
        .send({ name: 'Accept Once', email: `accept_once_${ts}@test.com`, password: 'password123' })

      const inviteRes = await supertest(app.server)
        .post(`/orgs/${orgSlug}/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: `accept_once_${ts}@test.com`, role: 'member' })

      const token = inviteRes.body.token

      await supertest(app.server)
        .post('/orgs/invite/accept')
        .set('Authorization', `Bearer ${acceptOnceRes.body.accessToken}`)
        .send({ token })

      // Try to accept the same token again
      const secondAccept = await supertest(app.server)
        .post('/orgs/invite/accept')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ token })

      expect(secondAccept.status).toBe(410)
      expect(secondAccept.body.error).toBe('INVITE_ALREADY_USED')
    })

    it('should return 410 for an expired invitation', async () => {
      const expiredToken = `expired_${ts}`

      await db.insert(invitations).values({
        orgId,
        email:     `expired_${ts}@test.com`,
        role:      'member',
        invitedBy: ownerUserId,
        token:     expiredToken,
        expiresAt: new Date(Date.now() - 1000), // already in the past
      })

      const res = await supertest(app.server)
        .post('/orgs/invite/accept')
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ token: expiredToken })

      expect(res.status).toBe(410)
      expect(res.body.error).toBe('INVITE_EXPIRED')
    })
  })

  // ===========================================================================
  describe('PATCH /orgs/:slug/members/:userId', () => {

    it('should return 403 if requesting user is not owner', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/members/${ownerUserId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ role: 'admin' })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })

    it('should update a member role successfully', async () => {
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/members/${memberUserId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'viewer' })

      expect(res.status).toBe(200)
      expect(res.body.message).toBe('Member role updated')
    })
  })

  // ===========================================================================
  describe('DELETE /orgs/:slug/members/:userId', () => {

    it('should return 403 if requesting user is not owner or admin', async () => {
      // member now has role 'viewer' (from the PATCH test above) — cannot remove others
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/members/${ownerUserId}`)
        .set('Authorization', `Bearer ${memberToken}`)

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })

    it('should remove a member successfully', async () => {
      const res = await supertest(app.server)
        .delete(`/orgs/${orgSlug}/members/${memberUserId}`)
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.message).toBe('Member removed')
    })
  })
})
