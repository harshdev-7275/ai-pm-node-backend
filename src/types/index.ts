import type { TokenPayload } from '../modules/auth/auth.types.js'
import type { AuthUser } from './fastify.js'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenPayload
    // AuthUser is wider than TokenPayload (email/sessionId optional) so the
    // bot-path synthesized identity (just { userId }) type-checks. JWT-signed
    // payloads always have email/sessionId; routes that read those fields
    // must run on the user-only path (behind the `authenticate` decorator,
    // not behind `requireProjectAccess`).
    user: AuthUser
  }
}
