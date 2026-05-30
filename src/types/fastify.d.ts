import type { FastifyRequest, FastifyReply } from 'fastify'
import type { TokenPayload } from '../modules/auth/auth.types.js'
import type { organizations, organizationMembers } from '../db/schema.js'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    user:       TokenPayload
    org:        typeof organizations.$inferSelect
    membership: Pick<typeof organizationMembers.$inferSelect, 'id' | 'role'>
  }
}
