import { eq, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { orgUsage } from '../../db/schema.js'

// =============================================================================
// METERING SERVICE
// Postgres-backed per-org token + request counters. The Python AI service
// (METERING_BACKEND=postgres) drives these through the /admin/metering/*
// routes. Increments are atomic upserts so concurrent ai-service instances
// never clobber each other's counts.
// =============================================================================

/**
 * Add `tokens` to an org's cumulative total and return the new total.
 * First write for an org inserts the row; subsequent writes increment it
 * atomically via onConflictDoUpdate. Non-positive deltas are a no-op read.
 */
export const addTokens = async (orgSlug: string, tokens: number): Promise<number> => {
  if (tokens <= 0) return getTokens(orgSlug)

  const [row] = await db
    .insert(orgUsage)
    .values({ orgSlug, tokens })
    .onConflictDoUpdate({
      target: orgUsage.orgSlug,
      set:    { tokens: sql`${orgUsage.tokens} + ${tokens}`, updatedAt: new Date() },
    })
    .returning({ tokens: orgUsage.tokens })

  return row?.tokens ?? 0
}

/** Read an org's cumulative token total. Returns 0 for an unseen org. */
export const getTokens = async (orgSlug: string): Promise<number> => {
  const [row] = await db
    .select({ tokens: orgUsage.tokens })
    .from(orgUsage)
    .where(eq(orgUsage.orgSlug, orgSlug))
    .limit(1)

  return row?.tokens ?? 0
}

/**
 * Bump an org's request count by one and return the new total.
 * Atomic upsert — same row, same concurrency guarantees as addTokens.
 */
export const incRequest = async (orgSlug: string): Promise<number> => {
  const [row] = await db
    .insert(orgUsage)
    .values({ orgSlug, requests: 1 })
    .onConflictDoUpdate({
      target: orgUsage.orgSlug,
      set:    { requests: sql`${orgUsage.requests} + 1`, updatedAt: new Date() },
    })
    .returning({ requests: orgUsage.requests })

  return row?.requests ?? 0
}

/** Read an org's cumulative request count. Returns 0 for an unseen org. */
export const getRequests = async (orgSlug: string): Promise<number> => {
  const [row] = await db
    .select({ requests: orgUsage.requests })
    .from(orgUsage)
    .where(eq(orgUsage.orgSlug, orgSlug))
    .limit(1)

  return row?.requests ?? 0
}
