import type { z } from 'zod'
import type {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.schema.js'

export type RegisterInput       = z.infer<typeof registerSchema>
export type LoginInput          = z.infer<typeof loginSchema>
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput  = z.infer<typeof resetPasswordSchema>

export interface TokenPayload {
  userId:    string
  email:     string
  sessionId: string  // refresh token ID — used to invalidate specific sessions
}

export interface AuthTokens {
  accessToken:  string
  refreshToken: string
  expiresIn:    number // seconds until access token expires
}

export interface AuthResponse {
  user: {
    id:        string
    name:      string
    email:     string
    avatarUrl: string | null
    jobTitle:  string | null
    timezone:  string
  }
  tokens: AuthTokens
}
