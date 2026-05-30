import type { FastifyRequest, FastifyReply } from 'fastify'
import type { TokenPayload } from '../modules/auth/auth.types.js'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    user: TokenPayload
  }
}
