import { z } from 'zod'

/** Body for POST /ai/chat — what the frontend sends to the BFF. */
export const chatRequestSchema = z.object({
  message:   z.string().min(1, 'message is required').max(4000, 'message is too long'),
  projectId: z.uuid().optional(),
})
