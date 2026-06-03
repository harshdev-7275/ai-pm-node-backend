import { describe, it, expect } from 'vitest'
import { refreshCookieOptions, REFRESH_COOKIE_PATH } from '../auth.cookies.js'

// Pure policy unit — no DB, no env validation, runs anywhere.
describe('refreshCookieOptions', () => {
  it('uses SameSite=None + Secure in production so the cross-site refresh cookie is sent', () => {
    const opts = refreshCookieOptions('production')

    // In prod the SPA and API live on different sites; the browser only sends
    // the cookie on the cross-site XHR refresh when it is SameSite=None + Secure.
    expect(opts.sameSite).toBe('none')
    expect(opts.secure).toBe(true)
    expect(opts.httpOnly).toBe(true)
    expect(opts.path).toBe(REFRESH_COOKIE_PATH)
  })

  it('uses SameSite=Lax without Secure in development so the cookie works over http localhost', () => {
    const opts = refreshCookieOptions('development')

    expect(opts.sameSite).toBe('lax')
    expect(opts.secure).toBe(false)
  })

  it('does not require Secure in the test environment', () => {
    const opts = refreshCookieOptions('test')

    expect(opts.sameSite).toBe('lax')
    expect(opts.secure).toBe(false)
  })
})
