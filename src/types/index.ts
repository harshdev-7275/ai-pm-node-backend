import type { TokenPayload } from '../modules/auth/auth.types.js'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenPayload
    user: TokenPayload
  }
}
