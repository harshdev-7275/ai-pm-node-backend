import type { z } from 'zod'
import type { chatRequestSchema } from './ai.schema.js'

export type ChatRequest = z.infer<typeof chatRequestSchema>

/** Verified caller identity, taken from the JWT — never from client headers. */
export interface ChatIdentity {
  userId:  string
  orgId:   string
  orgSlug: string
}

export interface ToolCallRecord {
  tool:           string
  args:           Record<string, unknown>
  result_preview: string | null
}

/** Shape returned by ai-service POST /v1/chat (passed through unchanged). */
export interface ChatResponse {
  message:    string
  tool_calls: ToolCallRecord[]
  model:      string
  steps:      number
}
