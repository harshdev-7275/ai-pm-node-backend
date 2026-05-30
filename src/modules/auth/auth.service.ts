import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { users, userAuth, refreshTokens } from '../../db/schema.js'
import { env } from '../../config/env.js'
import type { RegisterInput, LoginInput, AuthTokens, AuthResponse, TokenPayload } from './auth.types.js'
import crypto from 'crypto'

// =============================================================================
// TOKEN HELPERS
// =============================================================================

export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(
    payload,
    env.JWT_SECRET,
    {
      expiresIn: env.JWT_EXPIRES_IN as any,
    }
  )
}

export const generateRawRefreshToken = (): string => {
  return crypto.randomBytes(64).toString('hex')
}

export const hashToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// =============================================================================
// REGISTER
// =============================================================================

export const register = async (input: RegisterInput): Promise<AuthResponse> => {

  // 1. Check if email already exists
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, input.email.toLowerCase()))
    .limit(1)

  if (existing.length > 0) {
    throw new Error('EMAIL_TAKEN')
  }

  // 2. Hash the password
  const passwordHash = await bcrypt.hash(input.password, 12)

  // 3. Create the user
  const [newUser] = await db
    .insert(users)
    .values({
      name:     input.name,
      email:    input.email.toLowerCase(),
      jobTitle: input.jobTitle ?? null,
      timezone: 'UTC',
    })
    .returning()

  if (!newUser) throw new Error('REGISTRATION_FAILED')

  // 4. Create the auth record
  await db.insert(userAuth).values({
    userId:       newUser.id,
    provider:     'email',
    passwordHash: passwordHash,
  })

  // 5. Generate tokens
  const tokens = await createSession(newUser.id, newUser.email)

  return {
    user: {
      id:        newUser.id,
      name:      newUser.name,
      email:     newUser.email,
      avatarUrl: newUser.avatarUrl ?? null,
      jobTitle:  newUser.jobTitle ?? null,
      timezone:  newUser.timezone,
      createdAt: newUser.createdAt.toISOString(),
    },
    tokens,
  }
}

// =============================================================================
// LOGIN
// =============================================================================

export const login = async (input: LoginInput): Promise<AuthResponse> => {

  // 1. Find user by email
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, input.email.toLowerCase()))
    .limit(1)

  if (!user) {
    throw new Error('INVALID_CREDENTIALS')
  }

  // 2. Find their email auth record
  const [auth] = await db
    .select()
    .from(userAuth)
    .where(eq(userAuth.userId, user.id))
    .limit(1)

  if (!auth || !auth.passwordHash) {
    throw new Error('INVALID_CREDENTIALS')
  }

  // 3. Compare password
  const isValid = await bcrypt.compare(input.password, auth.passwordHash)

  if (!isValid) {
    throw new Error('INVALID_CREDENTIALS')
  }

  // 4. Update last active
  await db
    .update(users)
    .set({ lastActiveAt: new Date() })
    .where(eq(users.id, user.id))

  // 5. Generate tokens
  const tokens = await createSession(user.id, user.email)

  return {
    user: {
      id:        user.id,
      name:      user.name,
      email:     user.email,
      avatarUrl: user.avatarUrl ?? null,
      jobTitle:  user.jobTitle ?? null,
      timezone:  user.timezone,
      createdAt: user.createdAt.toISOString(),
    },
    tokens,
  }
}

// =============================================================================
// CREATE SESSION
// =============================================================================

export const createSession = async (
  userId: string,
  email:  string
): Promise<AuthTokens> => {

  // 1. Generate raw refresh token
  const rawRefreshToken = generateRawRefreshToken()
  const tokenHash       = hashToken(rawRefreshToken)

  // 2. Store hashed refresh token in DB
  const [session] = await db
    .insert(refreshTokens)
    .values({
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .returning()

  if (!session) throw new Error('SESSION_CREATION_FAILED')

  // 3. Generate access token
  const payload: TokenPayload = {
    userId,
    email,
    sessionId: session.id,
  }

  const accessToken = generateAccessToken(payload)

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    expiresIn:    15 * 60,
  }
}

// =============================================================================
// REFRESH TOKEN
// =============================================================================

export const refreshAccessToken = async (
  rawRefreshToken: string
): Promise<{ accessToken: string; expiresIn: number }> => {

  // 1. Hash the incoming token
  const tokenHash = hashToken(rawRefreshToken)

  // 2. Find it in DB
  const [session] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1)

  if (!session) {
    throw new Error('INVALID_REFRESH_TOKEN')
  }

  // 3. Check it's not revoked or expired
  if (session.revokedAt) {
    throw new Error('REFRESH_TOKEN_REVOKED')
  }

  if (session.expiresAt < new Date()) {
    throw new Error('REFRESH_TOKEN_EXPIRED')
  }

  // 4. Get the user
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!user) {
    throw new Error('USER_NOT_FOUND')
  }

  // 5. Issue new access token
  const payload: TokenPayload = {
    userId:    user.id,
    email:     user.email,
    sessionId: session.id,
  }

  const accessToken = generateAccessToken(payload)

  return { accessToken, expiresIn: 15 * 60 }
}

// =============================================================================
// GET ME
// =============================================================================

export const getMe = async (userId: string) => {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) {
    throw new Error('USER_NOT_FOUND')
  }

  return {
    id:        user.id,
    name:      user.name,
    email:     user.email,
    avatarUrl: user.avatarUrl ?? null,
    jobTitle:  user.jobTitle ?? null,
    timezone:  user.timezone,
    createdAt: user.createdAt,
  }
}

// =============================================================================
// LOGOUT
// =============================================================================

export const logout = async (sessionId: string): Promise<void> => {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.id, sessionId))
}
