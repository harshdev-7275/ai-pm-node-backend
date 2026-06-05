import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import supertest from 'supertest'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import { authRoutes } from '../../modules/auth/auth.routes.js'
import { orgsRoutes } from '../../modules/orgs/orgs.routes.js'
import { projectsRoutes } from '../../modules/projects/projects.routes.js'
import { issuesRoutes } from '../../modules/issues/issues.routes.js'
import { commentsRoutes } from '../../modules/issues/comments.routes.js'
import { sprintsRoutes } from '../../modules/sprints/sprints.routes.js'
import { handleError } from '../errorHandler.js'
import { env } from '../../config/env.js'

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
  await app.register(commentsRoutes, { prefix: '/orgs/:slug/projects/:projectId/issues' })
  await app.register(sprintsRoutes,  { prefix: '/orgs/:slug/projects/:projectId/sprints' })

  await app.ready()
  return app
}

const register = async (app: any, name: string, email: string) => {
  const res = await supertest(app.server)
    .post('/auth/register')
    .send({ name, email, password: 'password123' })
  return { token: res.body.accessToken as string, userId: res.body.user.id as string }
}

const joinOrg = async (app: any, slug: string, ownerToken: string, email: string, memberToken: string) => {
  const inv = await supertest(app.server)
    .post(`/orgs/${slug}/invite`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ email, role: 'member' })
  await supertest(app.server)
    .post('/orgs/invite/accept')
    .set('Authorization', `Bearer ${memberToken}`)
    .send({ token: inv.body.token })
}

// =============================================================================
// TESTS
// =============================================================================

describe('requireProjectAccess — project-role enforcement', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  const ts = Date.now()

  let ownerToken:    string
  let ownerUserId:   string
  let viewerToken:   string
  let viewerUserId:  string
  let memberToken:   string
  let memberUserId:  string
  let strangerToken:  string  // org member, NOT added to the project
  let strangerUserId: string
  let orgSlug:       string
  let projectId:     string
  let statusId:      string

  // Second org, used to prove cross-org isolation
  let foreignProjectId: string

  beforeAll(async () => {
    app = await buildTestApp()

    const owner = await register(app, 'PA Owner', `pa_owner_${ts}@test.com`)
    ownerToken  = owner.token
    ownerUserId = owner.userId

    const orgRes = await supertest(app.server)
      .post('/orgs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Access Org' })
    orgSlug = orgRes.body.slug

    const projRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Access Project', key: `PA${ts.toString().slice(-4)}` })
    projectId = projRes.body.id

    const statusesRes = await supertest(app.server)
      .get(`/orgs/${orgSlug}/projects/${projectId}/issues/statuses`)
      .set('Authorization', `Bearer ${ownerToken}`)
    statusId = statusesRes.body[0].id

    // viewer: org member added to the project as project 'viewer'
    const viewer = await register(app, 'PA Viewer', `pa_viewer_${ts}@test.com`)
    viewerToken  = viewer.token
    viewerUserId = viewer.userId
    await joinOrg(app, orgSlug, ownerToken, `pa_viewer_${ts}@test.com`, viewerToken)
    await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: viewerUserId, role: 'viewer' })

    // member: org member added to the project as project 'member'
    const member = await register(app, 'PA Member', `pa_member_${ts}@test.com`)
    memberToken  = member.token
    memberUserId = member.userId
    await joinOrg(app, orgSlug, ownerToken, `pa_member_${ts}@test.com`, memberToken)
    await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: memberUserId, role: 'member' })

    // stranger: org member but NOT added to the project
    const stranger = await register(app, 'PA Stranger', `pa_stranger_${ts}@test.com`)
    strangerToken  = stranger.token
    strangerUserId = stranger.userId
    await joinOrg(app, orgSlug, ownerToken, `pa_stranger_${ts}@test.com`, strangerToken)

    // Second org with its own project (different tenant)
    const owner2 = await register(app, 'PA Owner2', `pa_owner2_${ts}@test.com`)
    const org2Res = await supertest(app.server)
      .post('/orgs')
      .set('Authorization', `Bearer ${owner2.token}`)
      .send({ name: 'Foreign Org' })
    const proj2Res = await supertest(app.server)
      .post(`/orgs/${org2Res.body.slug}/projects`)
      .set('Authorization', `Bearer ${owner2.token}`)
      .send({ name: 'Foreign Project', key: `FN${ts.toString().slice(-4)}` })
    foreignProjectId = proj2Res.body.id
  }, 90000)

  afterAll(async () => {
    await app.close()
  }, 30000)

  const createIssueAs = (token: string) =>
    supertest(app.server)
      .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Test issue', statusId, type: 'task', priority: 'medium' })

  // --- read access -----------------------------------------------------------

  it('project viewer CAN read the issue list', async () => {
    const res = await supertest(app.server)
      .get(`/orgs/${orgSlug}/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${viewerToken}`)
    expect(res.status).toBe(200)
  })

  // --- write access ----------------------------------------------------------

  it('project viewer CANNOT create an issue — 403', async () => {
    const res = await createIssueAs(viewerToken)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('FORBIDDEN')
  })

  it('project member CAN create an issue — 201', async () => {
    const res = await createIssueAs(memberToken)
    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
  })

  // --- lead-only sprint lifecycle -------------------------------------------

  it('project member CANNOT start a sprint (lead only) — 403', async () => {
    const sprintRes = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects/${projectId}/sprints`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Sprint 1' })

    const res = await supertest(app.server)
      .post(`/orgs/${orgSlug}/projects/${projectId}/sprints/${sprintRes.body.id}/start`)
      .set('Authorization', `Bearer ${memberToken}`)

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('FORBIDDEN')
  })

  // --- not a project member --------------------------------------------------

  it('org member who is NOT on the project CANNOT read its issues — 403', async () => {
    const res = await supertest(app.server)
      .get(`/orgs/${orgSlug}/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${strangerToken}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('FORBIDDEN')
  })

  // --- tenant isolation ------------------------------------------------------

  it('cannot reach another org\'s project via your own org slug — 404', async () => {
    const res = await supertest(app.server)
      .get(`/orgs/${orgSlug}/projects/${foreignProjectId}/issues`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('PROJECT_NOT_FOUND')
  })

  // ===========================================================================
  // BOT PATH — the AI service authenticates with X-Bot-Secret and acts on
  // behalf of the user in X-Bot-User-Id. The bot secret authenticates the
  // SERVICE; it must NOT grant blanket 'lead'. The acting user's real project
  // access governs what the bot may do.
  // ===========================================================================

  describe('bot path — authorizes as the acting user, not blanket lead', () => {
    const createIssueAsBot = (botUserId?: string) => {
      const r = supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('X-Bot-Secret', env.BOT_SECRET)
        .send({ title: 'Bot issue', statusId, type: 'task', priority: 'medium' })
      return botUserId ? r.set('X-Bot-User-Id', botUserId) : r
    }

    it('rejects an invalid bot secret — 401', async () => {
      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('X-Bot-Secret', 'not-the-real-secret')
        .set('X-Bot-User-Id', memberUserId)
        .send({ title: 'Bot issue', statusId, type: 'task', priority: 'medium' })
      expect(res.status).toBe(401)
    })

    it('rejects a bot write with NO acting user — 403', async () => {
      const res = await createIssueAsBot()
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })

    it('bot acting as a project VIEWER CANNOT create an issue — 403', async () => {
      const res = await createIssueAsBot(viewerUserId)
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })

    it('bot acting as an org member NOT on the project CANNOT create — 403', async () => {
      const res = await createIssueAsBot(strangerUserId)
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('FORBIDDEN')
    })

    it('bot acting as a project MEMBER CAN create an issue — 201', async () => {
      const res = await createIssueAsBot(memberUserId)
      expect(res.status).toBe(201)
      expect(res.body.id).toBeDefined()
    })

    it('bot acting as an org OWNER (resolves to lead) CAN create an issue — 201', async () => {
      const res = await createIssueAsBot(ownerUserId)
      expect(res.status).toBe(201)
    })

    it('bot acting as a project VIEWER CAN still read issues — 200', async () => {
      const res = await supertest(app.server)
        .get(`/orgs/${orgSlug}/projects/${projectId}/issues`)
        .set('X-Bot-Secret', env.BOT_SECRET)
        .set('X-Bot-User-Id', viewerUserId)
      expect(res.status).toBe(200)
    })

    // --- regression: bot path must synthesize req.user so PATCH works -------
    // The pre-fix bug: PATCH /issues/:id accessed req.user.userId directly
    // (no req.isBot fallback), so every bot-originated PATCH crashed with
    // "Cannot read properties of null (reading 'userId')" — surfaced by
    // the AI assistant's "assign all open issues to Ranu" bulk call.
    it('bot acting as a project MEMBER CAN update an issue — 200', async () => {
      // Create an issue first (as the bot acting as member — already covered above)
      const create = await createIssueAsBot(memberUserId)
      expect(create.status).toBe(201)
      const issueId = create.body.id as string

      // PATCH it as the bot — this used to 500
      const res = await supertest(app.server)
        .patch(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}`)
        .set('X-Bot-Secret', env.BOT_SECRET)
        .set('X-Bot-User-Id', memberUserId)
        .send({ priority: 'high' })

      expect(res.status).toBe(200)
      expect(res.body.priority).toBe('high')
    })

    it('bot acting as a project MEMBER CAN add a comment — 201', async () => {
      // Same family of bug — POST /:issueId/comments used to crash for the
      // same reason. Locked in here so a future refactor can't regress it.
      const create = await createIssueAsBot(memberUserId)
      const issueId = create.body.id as string

      const res = await supertest(app.server)
        .post(`/orgs/${orgSlug}/projects/${projectId}/issues/${issueId}/comments`)
        .set('X-Bot-Secret', env.BOT_SECRET)
        .set('X-Bot-User-Id', memberUserId)
        .send({ body: 'bot comment' })

      expect(res.status).toBe(201)
    })
  })
})
