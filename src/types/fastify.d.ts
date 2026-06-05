import type { FastifyRequest, FastifyReply } from 'fastify'
import type { organizations, organizationMembers, projectMembers } from '../db/schema.js'

/**
 * The shape of `req.user` after an auth middleware (authenticate or
 * requireProjectAccess) has run. The user path populates this from a
 * verified JWT (userId + email + sessionId are all present). The bot
 * path synthesizes a narrow { userId } identity from X-Bot-User-Id —
 * sufficient for every route that just needs the acting user's id.
 *
 * email/sessionId are optional because the bot path does not have them.
 * Routes that require them MUST run on the user path (behind the
 * `authenticate` decorator, NOT behind `requireProjectAccess`).
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
    isBot:       boolean
    botUserId:   string | undefined
    /** Effective project access level, set by the requireProjectAccess guard. */
    projectRole: (typeof projectMembers.$inferSelect)['role']
  }
}
