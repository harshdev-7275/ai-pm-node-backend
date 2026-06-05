import { z } from 'zod'

// =============================================================================
// METERING VALIDATION
// =============================================================================

/**
 * Body for POST /admin/metering/:org/add.
 * The AI service sends a non-negative token delta. Zero is allowed (no-op)
 * so the caller never has to special-case an empty LLM turn.
 */
export const addTokensSchema = z.object({
  tokens: z.number().int().nonnegative(),
})

export type AddTokensInput = z.infer<typeof addTokensSchema>
