import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Persistence is a DB concern tested separately — mock it here so the trigger
// tests stay pure (fetch wire contract + log lifecycle calls only).
vi.mock('../kgSyncLog.service.js', () => ({
  recordSyncStart:  vi.fn().mockResolvedValue('log-id-1'),
  recordSyncFinish: vi.fn().mockResolvedValue(undefined),
}))

import { triggerProjectGraphSync, triggerGraphSync } from '../ai.service.js'
import { recordSyncStart, recordSyncFinish } from '../kgSyncLog.service.js'
import { env } from '../../../config/env.js'

const ORG_ID     = '11111111-1111-4111-8111-111111111111'
const ORG_SLUG   = 'acme'
const PROJECT_ID = '22222222-2222-4222-8222-222222222222'

const okResponse = () => new Response(JSON.stringify({}), { status: 200 })

describe('graph sync triggers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(recordSyncStart).mockResolvedValue('log-id-1')
    env.AI_SERVICE_TOKEN = 'x'.repeat(32)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('triggerProjectGraphSync posts to the incremental endpoint and records success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    vi.stubGlobal('fetch', fetchMock)

    await triggerProjectGraphSync(ORG_ID, ORG_SLUG, PROJECT_ID)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${env.AI_SERVICE_URL}/v1/graph/sync/project/${PROJECT_ID}`)
    expect(init.method).toBe('POST')

    const headers = init.headers as Record<string, string>
    expect(headers['X-Service-Token']).toBe(env.AI_SERVICE_TOKEN)

    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ org_id: ORG_ID, org_slug: ORG_SLUG, project_id: PROJECT_ID })

    expect(recordSyncStart).toHaveBeenCalledWith({ orgId: ORG_ID, projectId: PROJECT_ID, kind: 'incremental' })
    expect(recordSyncFinish).toHaveBeenCalledWith('log-id-1', { status: 'success' })
  })

  it('records an error when ai-service returns a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))

    await triggerProjectGraphSync(ORG_ID, ORG_SLUG, PROJECT_ID)

    expect(recordSyncFinish).toHaveBeenCalledWith('log-id-1', expect.objectContaining({ status: 'error' }))
  })

  it('records an error when ai-service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    await triggerProjectGraphSync(ORG_ID, ORG_SLUG, PROJECT_ID)

    expect(recordSyncFinish).toHaveBeenCalledWith('log-id-1', expect.objectContaining({ status: 'error' }))
  })

  it('triggerGraphSync posts a full org sync and logs kind=full with no project', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    vi.stubGlobal('fetch', fetchMock)

    await triggerGraphSync(ORG_ID, ORG_SLUG)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${env.AI_SERVICE_URL}/v1/graph/sync`)
    expect(JSON.parse(init.body as string)).toEqual({ org_id: ORG_ID, org_slug: ORG_SLUG })
    expect(recordSyncStart).toHaveBeenCalledWith({ orgId: ORG_ID, projectId: null, kind: 'full' })
  })

  it('does nothing when AI_SERVICE_TOKEN is not configured', async () => {
    env.AI_SERVICE_TOKEN = undefined
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await triggerProjectGraphSync(ORG_ID, ORG_SLUG, PROJECT_ID)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(recordSyncStart).not.toHaveBeenCalled()
  })
})
