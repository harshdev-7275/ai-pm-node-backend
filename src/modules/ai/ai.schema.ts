import { z } from 'zod'

/** One prior conversation turn replayed by the client for multi-turn context. */
export const chatTurnSchema = z.object({
  role:    z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
})

/** Body for POST /ai/chat — what the frontend sends to the BFF. */
export const chatRequestSchema = z.object({
  message:   z.string().min(1, 'message is required').max(4000, 'message is too long'),
  projectId: z.uuid().optional(),
  history:   z.array(chatTurnSchema).max(50).optional(),
})
