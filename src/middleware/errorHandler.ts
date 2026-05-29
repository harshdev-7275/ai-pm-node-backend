import { ZodError, z } from 'zod'
import { AppError } from '@/utils/errors.js'

interface ErrorContext {
  logError: (obj: object, msg: string) => void
  send: (statusCode: number, body: object) => void
}

export function handleError(error: unknown, ctx: ErrorContext): void {
  if (error instanceof AppError) {
    ctx.send(error.statusCode, { ok: false, code: error.code, message: error.message })
    return
  }
  if (error instanceof ZodError) {
    ctx.send(400, { ok: false, code: 'VALIDATION_ERROR', errors: z.flattenError(error).fieldErrors })
    return
  }
  ctx.logError({ err: error }, 'Unhandled error')
  ctx.send(500, { ok: false, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' })
}
