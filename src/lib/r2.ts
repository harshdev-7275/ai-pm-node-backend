import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import crypto from 'crypto'
import { env } from '../config/env.js'
import { AppError } from '../utils/errors.js'

// =============================================================================
// CLOUDFLARE R2 (S3-COMPATIBLE) STORAGE
// =============================================================================
//
// The bucket is PRIVATE. We never store a public URL — `users.avatar_url`
// holds the object *key* (e.g. "avatars/<userId>/<uuid>.png"). Reads are
// served via short-lived presigned GET URLs generated when we serialize a
// user; uploads go browser → R2 directly via a presigned PUT URL.

// Allowed avatar MIME types → file extension used for the object key.
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif':  'gif',
}

const UPLOAD_URL_TTL = 5 * 60        // presigned PUT valid for 5 minutes
const READ_URL_TTL   = 24 * 60 * 60  // presigned GET valid for 24 hours

/** True when all four R2 env vars are present. */
export function isStorageConfigured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET,
  )
}

// Lazily build the client so the app still boots when R2 is unconfigured.
let client: S3Client | null = null
function getClient(): S3Client {
  if (!isStorageConfigured()) {
    throw new AppError('STORAGE_NOT_CONFIGURED', 'Object storage is not configured', 503)
  }
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
      // AWS SDK v3 (>= 3.729) adds an x-amz-checksum-crc32 header to presigned
      // PUTs that R2 rejects (the placeholder checksum never matches the body).
      // Only compute checksums when an operation actually requires one.
      requestChecksumCalculation:  'WHEN_REQUIRED',
      responseChecksumValidation:  'WHEN_REQUIRED',
    })
  }
  return client
}

/**
 * Generate a presigned PUT URL the browser uploads the avatar to directly.
 * The returned `key` is what the client sends back to PATCH /me.
 */
export async function presignAvatarUpload(
  userId:      string,
  contentType: string,
): Promise<{ uploadUrl: string; key: string }> {
  const ext = ALLOWED_IMAGE_TYPES[contentType]
  if (!ext) {
    throw new AppError('INVALID_FILE_TYPE', 'Unsupported image type', 400)
  }

  const key = `avatars/${userId}/${crypto.randomUUID()}.${ext}`
  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({ Bucket: env.R2_BUCKET!, Key: key, ContentType: contentType }),
    { expiresIn: UPLOAD_URL_TTL },
  )
  return { uploadUrl, key }
}

/**
 * Turn a stored object key into a short-lived presigned GET URL the browser
 * can render in an <img>. Returns null for a null/empty key, or when storage
 * is unconfigured (so user serialization never throws).
 */
export async function signAvatarUrl(key: string | null | undefined): Promise<string | null> {
  if (!key || !isStorageConfigured()) return null
  // Defensive: if a full URL ever ends up stored, pass it through unsigned.
  if (/^https?:\/\//.test(key)) return key
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: env.R2_BUCKET!, Key: key }),
    { expiresIn: READ_URL_TTL },
  )
}
