import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { kgSyncLog } from '../../db/schema.js'
import { logger } from '../../utils/logger.js'

export type KgSyncKind = 'incremental' | 'full'

export interface SyncStartInput {
  orgId:     string
  /** null for a full org sync (not scoped to a single project) */
  projectId: string | null
  kind:      KgSyncKind
}

export interface SyncFinishInput {
  status: 'success' | 'error'
  /** Short failure reason — clipped to the column width. Never include PII. */
  error?: string
}

/**
 * Insert a 'pending' kg_sync_log row and return its id.
 *
 * Best-effort: if the insert fails we log and return null so the caller can
 * still fire the sync. Observability must never break the sync itself.
 */
export const recordSyncStart = async (input: SyncStartInput): Promise<string | null> => {
  try {
    const [row] = await db
      .insert(kgSyncLog)
      .values({
        orgId:     input.orgId,
        projectId: input.projectId,
        kind:      input.kind,
        status:    'pending',
      })
      .returning({ id: kgSyncLog.id })

    return row?.id ?? null
  } catch (err: unknown) {
    logger.warn({ err, orgId: input.orgId, projectId: input.projectId, kind: input.kind },
      'kg_sync_log: failed to record sync start')
    return null
  }
}

/**
 * Mark a kg_sync_log row finished (success or error). No-op when `id` is null —
 * i.e. the start row was never recorded. Best-effort — never throws.
 */
export const recordSyncFinish = async (
  id:    string | null,
  input: SyncFinishInput,
): Promise<void> => {
  if (!id) return
  try {
    await db
      .update(kgSyncLog)
      .set({
        status:     input.status,
        finishedAt: new Date(),
        error:      input.error ? input.error.slice(0, 1000) : null,
      })
      .where(eq(kgSyncLog.id, id))
  } catch (err: unknown) {
    logger.warn({ err, id }, 'kg_sync_log: failed to record sync finish')
  }
}
