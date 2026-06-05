import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { env } from '../../config/env.js'
import { emitGraphEvent } from '../graphEvents.js'

// Let the fire-and-forget async IIFE settle before asserting.
const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('emitGraphEvent', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  it('POSTs the event to the AI service with the internal secret', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({ status: 200 } as Response)

    emitGraphEvent('issue', { id: 'issue-1', title: 'x' })
    await flush()

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${env.AI_SERVICE_URL}/graph/events`)
    expect(options!.method).toBe('POST')

    const headers = options!.headers as Record<string, string>
    expect(headers['X-Internal-Secret']).toBe(env.INTERNAL_SECRET)

    const body = JSON.parse(options!.body as string)
    expect(body).toEqual({ entity: 'issue', data: { id: 'issue-1', title: 'x' } })
  })

  it('does not throw when the AI service is unreachable', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    // Must not throw synchronously...
    expect(() => emitGraphEvent('sprint', { id: 's-1' })).not.toThrow()
    // ...and the swallowed rejection must not surface after the tick either.
    await expect(flush()).resolves.toBeUndefined()
  })

  it('returns synchronously without awaiting the network call', () => {
    let resolveFetch: (v: Response) => void = () => {}
    vi.spyOn(global, 'fetch').mockReturnValue(
      new Promise<Response>((res) => { resolveFetch = res }),
    )

    // The call returns void immediately even though fetch is still pending.
    expect(emitGraphEvent('issue', { id: 'issue-2' })).toBeUndefined()
    resolveFetch({ status: 200 } as Response)
  })
})
