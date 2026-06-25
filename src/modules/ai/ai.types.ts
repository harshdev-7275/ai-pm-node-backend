import type { z } from 'zod'
import type { chatRequestSchema, suggestionRequestSchema } from './ai.schema.js'

export type ChatRequest = z.infer<typeof chatRequestSchema>
export type SuggestionRequest = z.infer<typeof suggestionRequestSchema>

/** A single prompt suggestion returned to the client. */
export interface Suggestion {
  id:        string
  label:     string   // short chip label shown in the UI
  prompt:    string   // full question text sent to the AI
  projectId?: string  // pre-scopes the chat turn when set
}

export interface SuggestionsResponse {
  suggestions: Suggestion[]
}

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
