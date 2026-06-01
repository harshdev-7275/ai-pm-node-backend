export type ErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
  | 'SPRINT_NOT_FOUND'
  | 'SPRINT_CREATION_FAILED'
  | 'SPRINT_UPDATE_FAILED'
  | 'SPRINT_COMPLETE_FAILED'
  | 'SPRINT_START_FAILED'
  | 'SPRINT_COMPLETED'
  | 'SPRINT_ACTIVE'
  | 'SPRINT_NOT_ACTIVE'
  | 'SPRINT_ALREADY_STARTED'
  | 'ACTIVE_SPRINT_EXISTS'
  | 'ISSUE_NOT_FOUND'
  | 'SPRINT_AUTO_CREATE_FAILED'

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number = 500,
  ) {
    super(message)
    this.name = 'AppError'
  }
}
