import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../../../db/index.js'
import { kgSyncLog, organizations } from '../../../db/schema.js'
import { recordSyncStart, recordSyncFinish } from '../kgSyncLog.service.js'

describe('kgSyncLog.service (integration)', () => {
  let orgId: string
  const createdLogIds: string[] = []

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: 'KG Sync Test Org', slug: `kg-sync-${Date.now()}` })
      .returning({ id: organizations.id })
    orgId = org!.id
  }, 30000)

  afterAll(async () => {
    for (const id of createdLogIds) {
      await db.delete(kgSyncLog).where(eq(kgSyncLog.id, id))
    }
    await db.delete(organizations).where(eq(organizations.id, orgId))
  })

  it('records a pending row then marks it success with a finishedAt', async () => {
    const id = await recordSyncStart({ orgId, projectId: null, kind: 'full' })
    expect(id).toBeTruthy()
    createdLogIds.push(id!)

    const [pending] = await db.select().from(kgSyncLog).where(eq(kgSyncLog.id, id!))
    expect(pending?.status).toBe('pending')
    expect(pending?.kind).toBe('full')
    expect(pending?.finishedAt).toBeNull()

    await recordSyncFinish(id, { status: 'success' })

    const [done] = await db.select().from(kgSyncLog).where(eq(kgSyncLog.id, id!))
    expect(done?.status).toBe('success')
    expect(done?.finishedAt).not.toBeNull()
    expect(done?.error).toBeNull()
  })

  it('records an error with a clipped message', async () => {
    const id = await recordSyncStart({ orgId, projectId: null, kind: 'full' })
    createdLogIds.push(id!)

    await recordSyncFinish(id, { status: 'error', error: 'ai-service unreachable' })

    const [row] = await db.select().from(kgSyncLog).where(eq(kgSyncLog.id, id!))
    expect(row?.status).toBe('error')
    expect(row?.error).toBe('ai-service unreachable')
  })

  it('recordSyncFinish is a no-op for a null id', async () => {
    await expect(recordSyncFinish(null, { status: 'success' })).resolves.toBeUndefined()
  })
})
