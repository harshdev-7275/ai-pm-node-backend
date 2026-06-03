import type { env } from '../../config/env.js'

// Derived from the validated env enum (type-only import — erased at runtime, so
// this module stays free of env validation and DB imports and is unit-testable).
type NodeEnv = typeof env.NODE_ENV

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60

// The refresh cookie is scoped to the one endpoint that needs it.
export const REFRESH_COOKIE_PATH = '/auth/refresh'

interface RefreshCookieOptions {
  httpOnly: boolean
  secure:   boolean
  sameSite: 'none' | 'lax'
  maxAge:   number
  path:     string
}

/**
 * Cookie options for the refresh token.
 *
 * In production the SPA and API are served from different sites, so the browser
 * only sends the cookie on the cross-site XHR refresh when it is
 * SameSite=None + Secure. Local dev/test run both on http://localhost (same
 * site) where Lax works and Secure would block the cookie over http.
 */
export function refreshCookieOptions(nodeEnv: NodeEnv): RefreshCookieOptions {
  const isProd = nodeEnv === 'production'
  return {
    httpOnly: true,
    secure:   isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge:   THIRTY_DAYS_SECONDS,
    path:     REFRESH_COOKIE_PATH,
  }
}
