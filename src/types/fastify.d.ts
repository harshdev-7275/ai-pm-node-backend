// Inside `declare module 'fastify'` the FastifyRequest/FastifyReply names
// resolve to the module's own (augmented) types — no value import needed.
import type { FastifyReply } from 'fastify'
import type { organizations, organizationMembers, projectMembers } from '../db/schema.js'

/**
 * The shape of `req.user` after an auth middleware (authenticate or
 * requireProjectAccess) has run. Populated from a verified JWT — userId,
 * email and sessionId are all present.
 */
export interface AuthUser {
  userId:    string
  email?:    string
  sessionId?: string
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    /** Always set after an auth middleware has run. Never null. */
    user:        AuthUser
    org:         typeof organizations.$inferSelect
    membership:  Pick<typeof organizationMembers.$inferSelect, 'id' | 'role'>
    /** Effective project access level, set by the requireProjectAccess guard. */
    projectRole: (typeof projectMembers.$inferSelect)['role']
  }
}
