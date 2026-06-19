import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGraphSyncHook } from '../graphSync.hook.js'

const syncProject = vi.fn()
const syncOrg     = vi.fn()
const hook = createGraphSyncHook({ syncProject, syncOrg })

const makeReq = (over: Record<string, unknown> = {}): any => ({
  method:       'POST',
  org:          { id: 'org-1', slug: 'acme' },
  params:       { projectId: 'proj-1' },
  routeOptions: { url: '/orgs/:slug/projects/:projectId/sprints' },
  ...over,
})

const makeReply = (statusCode = 200): any => ({ statusCode })

describe('createGraphSyncHook', () => {
  beforeEach(() => {
    syncProject.mockReset()
    syncOrg.mockReset()
  })

  it('fires an incremental project sync after a successful issue mutation', async () => {
    await hook(
      makeReq({ routeOptions: { url: '/orgs/:slug/projects/:projectId/issues' } }),
      makeReply(201),
    )
    expect(syncProject).toHaveBeenCalledWith('org-1', 'acme', 'proj-1')
    expect(syncOrg).not.toHaveBeenCalled()
  })

  it('treats comment routes (nested under /issues) as incremental', async () => {
    await hook(
      makeReq({ routeOptions: { url: '/orgs/:slug/projects/:projectId/issues/:issueId/comments' } }),
      makeReply(201),
    )
    expect(syncProject).toHaveBeenCalledTimes(1)
    expect(syncOrg).not.toHaveBeenCalled()
  })

  it('fires a full org sync for structural (non-issue) project routes', async () => {
    await hook(
      makeReq({ routeOptions: { url: '/orgs/:slug/projects/:projectId/sprints/:sprintId/start' } }),
      makeReply(200),
    )
    expect(syncOrg).toHaveBeenCalledWith('org-1', 'acme')
    expect(syncProject).not.toHaveBeenCalled()
  })

  it('fires a full org sync for project member changes', async () => {
    await hook(
      makeReq({ routeOptions: { url: '/orgs/:slug/projects/:projectId/members/:userId' }, method: 'DELETE' }),
      makeReply(200),
    )
    expect(syncOrg).toHaveBeenCalledWith('org-1', 'acme')
  })

  it('ignores read requests', async () => {
    await hook(makeReq({ method: 'GET' }), makeReply(200))
    expect(syncProject).not.toHaveBeenCalled()
    expect(syncOrg).not.toHaveBeenCalled()
  })

  it('ignores non-2xx responses', async () => {
    await hook(makeReq(), makeReply(400))
    expect(syncProject).not.toHaveBeenCalled()
    expect(syncOrg).not.toHaveBeenCalled()
  })

  it('ignores requests without a :projectId (e.g. project create / org routes)', async () => {
    await hook(
      makeReq({ params: {}, routeOptions: { url: '/orgs/:slug/projects' } }),
      makeReply(201),
    )
    expect(syncProject).not.toHaveBeenCalled()
    expect(syncOrg).not.toHaveBeenCalled()
  })

  it('ignores requests with no resolved org', async () => {
    await hook(makeReq({ org: undefined }), makeReply(200))
    expect(syncProject).not.toHaveBeenCalled()
    expect(syncOrg).not.toHaveBeenCalled()
  })
})
