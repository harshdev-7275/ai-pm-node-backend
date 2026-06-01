import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate.js'
import { env } from '../../config/env.js'

const ChatBodySchema = z.object({
  message:   z.string().min(1),
  orgSlug:   z.string().min(1),
  projectId: z.string().uuid(),
})

export const chatRoutes = async (app: FastifyInstance) => {

  // POST /api/chat — proxy to AI service with server-side secret injection
  // Protected by JWT — userId comes from the verified token, never from the client
  app.post('/', {
    preHandler: [authenticate],
    schema: {
      summary:  'Chat proxy',
      tags:     ['Chat'],
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const parsed = ChatBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })
    }

    const { message, orgSlug, projectId } = parsed.data
    const userId = req.user.userId

    const response = await fetch(`${env.AI_SERVICE_URL}/chat`, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-Internal-Secret': env.INTERNAL_SECRET,
      },
      body: JSON.stringify({
        message,
        user_id:    userId,
        org_slug:   orgSlug,
        project_id: projectId,
      }),
    })

    const data = await response.json()
    return reply.status(response.status).send(data)
  })
}
