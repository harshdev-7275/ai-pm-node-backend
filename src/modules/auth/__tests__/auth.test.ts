import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import supertest from 'supertest'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import { authRoutes } from '../auth.routes.js'
import { env } from '../../../config/env.js'

// =============================================================================
// TEST APP SETUP
// =============================================================================

const buildApp = async () => {
  const app = Fastify()

  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: env.JWT_SECRET })
  await app.register(cookie, { secret: env.JWT_SECRET })

  app.decorate('authenticate', async (req: any, reply: any) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '')
      if (!token) {
        return reply.status(401).send({ error: 'UNAUTHORIZED' })
      }
      req.user = app.jwt.verify(token)
    } catch {
      return reply.status(401).send({ error: 'UNAUTHORIZED' })
    }
  })

  await app.register(authRoutes)
  await app.ready()
  return app
}

// =============================================================================
// TESTS
// =============================================================================

describe('Auth API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let accessToken: string
  const testEmail = `test_${Date.now()}@acme.com` // unique per run

  beforeAll(async () => {
    app = await buildApp()
  })

  afterAll(async () => {
    await app.close()
  })

  // -------------------------------------------------------------------------
  describe('POST /auth/register', () => {

    it('should register a new user successfully', async () => {
      const res = await supertest(app.server)
        .post('/auth/register')
        .send({
          name:     'Test User',
          email:    testEmail,
          password: 'password123',
          jobTitle: 'engineer'
        })

      expect(res.status).toBe(201)
      expect(res.body.user).toBeDefined()
      expect(res.body.user.email).toBe(testEmail)
      expect(res.body.user.name).toBe('Test User')
      expect(res.body.user.jobTitle).toBe('engineer')
      expect(res.body.accessToken).toBeDefined()
      // refreshToken is set as HttpOnly cookie — not in body
    })

    it('should reject duplicate email', async () => {
      const res = await supertest(app.server)
        .post('/auth/register')
        .send({
          name:     'Test User',
          email:    testEmail, // same email
          password: 'password123',
        })

      expect(res.status).toBe(409)
      expect(res.body.error).toBe('EMAIL_TAKEN')
    })

    it('should reject invalid email', async () => {
      const res = await supertest(app.server)
        .post('/auth/register')
        .send({
          name:     'Test User',
          email:    'not-an-email',
          password: 'password123',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
    })

    it('should reject short password', async () => {
      const res = await supertest(app.server)
        .post('/auth/register')
        .send({
          name:     'Test User',
          email:    'another@acme.com',
          password: '123', // too short
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
    })

    it('should reject missing name', async () => {
      const res = await supertest(app.server)
        .post('/auth/register')
        .send({
          email:    'another@acme.com',
          password: 'password123',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
    })
  })

  // -------------------------------------------------------------------------
  describe('POST /auth/login', () => {

    it('should login successfully with correct credentials', async () => {
      const res = await supertest(app.server)
        .post('/auth/login')
        .send({
          email:    testEmail,
          password: 'password123',
        })

      expect(res.status).toBe(200)
      expect(res.body.user.email).toBe(testEmail)
      expect(res.body.accessToken).toBeDefined()

      accessToken = res.body.accessToken
    })

    it('should reject wrong password', async () => {
      const res = await supertest(app.server)
        .post('/auth/login')
        .send({
          email:    testEmail,
          password: 'wrongpassword',
        })

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('INVALID_CREDENTIALS')
    })

    it('should reject non-existent email', async () => {
      const res = await supertest(app.server)
        .post('/auth/login')
        .send({
          email:    'nobody@acme.com',
          password: 'password123',
        })

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('INVALID_CREDENTIALS')
    })

    it('should reject missing password', async () => {
      const res = await supertest(app.server)
        .post('/auth/login')
        .send({
          email: testEmail,
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
    })
  })

  // -------------------------------------------------------------------------
  describe('GET /auth/me', () => {

    it('should return current user with valid token', async () => {
      const res = await supertest(app.server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)

      expect(res.status).toBe(200)
      expect(res.body.email).toBe(testEmail)
      expect(res.body.name).toBe('Test User')
    })

    it('should reject request with no token', async () => {
      const res = await supertest(app.server)
        .get('/auth/me')

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('UNAUTHORIZED')
    })

    it('should reject request with invalid token', async () => {
      const res = await supertest(app.server)
        .get('/auth/me')
        .set('Authorization', 'Bearer invalidtoken123')

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('UNAUTHORIZED')
    })
  })

  // -------------------------------------------------------------------------
  describe('POST /auth/logout', () => {

    it('should logout successfully', async () => {
      const res = await supertest(app.server)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)

      expect(res.status).toBe(200)
      expect(res.body.message).toBe('Logged out successfully')
    })

    it('should reject logout with no token', async () => {
      const res = await supertest(app.server)
        .post('/auth/logout')

      expect(res.status).toBe(401)
    })
  })
})
