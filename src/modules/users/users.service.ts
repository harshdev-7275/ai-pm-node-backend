import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { users } from '../../db/schema.js'
import { AppError } from '../../utils/errors.js'
import { presignAvatarUpload, signAvatarUrl } from '../../lib/r2.js'

// =============================================================================
// USER PROFILE SERVICE
// =============================================================================

/** Serialize a user row for API responses, signing the avatar key into a URL. */
async function serializeUser(user: typeof users.$inferSelect) {
  return {
    id:        user.id,
    name:      user.name,
    email:     user.email,
    avatarUrl: await signAvatarUrl(user.avatarUrl),
    jobTitle:  user.jobTitle ?? null,
    timezone:  user.timezone,
    createdAt: user.createdAt.toISOString(),
  }
}

/** Issue a presigned PUT URL for a new avatar upload. */
export const createAvatarUploadUrl = async (userId: string, contentType: string) => {
  return presignAvatarUpload(userId, contentType)
}

/**
 * Persist a new avatar object key (or clear it with null) on the user, then
 * return the freshly-serialized user with a signed avatar URL.
 */
export const updateAvatar = async (userId: string, key: string | null) => {
  // Ownership guard: a client may only attach keys under its own prefix.
  if (key !== null && !key.startsWith(`avatars/${userId}/`)) {
    throw new AppError('INVALID_FILE_TYPE', 'Avatar key does not belong to this user', 400)
  }

  const [updated] = await db
    .update(users)
    .set({ avatarUrl: key })
    .where(eq(users.id, userId))
    .returning()

  if (!updated) throw new AppError('USER_NOT_FOUND', 'User not found', 404)

  return serializeUser(updated)
}
