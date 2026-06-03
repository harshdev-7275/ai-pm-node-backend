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
  let viewerToken:   string
  let viewerUserId:  string
  let memberToken:   string
  let memberUserId:  string
  let strangerToken: string  // org member, NOT added to the project
  let orgSlug:       string
  let projectId:     string
  let statusId:      string

  // Second org, used to prove cross-org isolation
  let foreignProjectId: string

  beforeAll(async () => {
    app = await buildTestApp()

    const owner = await register(app, 'PA Owner', `pa_owner_${ts}@test.com`)
    ownerToken = owner.token

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
    strangerToken = stranger.token
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
})
