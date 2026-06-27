import { AwsClient } from 'aws4fetch'

export interface R2PresignEnv {
  R2_ACCOUNT_ID: string
  R2_BUCKET_NAME: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
}

export interface PresignedUrl {
  url: string
  expiresAt: number
}

const DEFAULT_TTL_SECONDS = 60

function getR2Client(env: R2PresignEnv): AwsClient {
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  })
}

function buildR2ObjectUrl(env: R2PresignEnv, key: string): URL {
  const accountId = env.R2_ACCOUNT_ID
  const bucket = env.R2_BUCKET_NAME
  if (!accountId) throw new Error('R2_ACCOUNT_ID is not configured')
  if (!bucket) throw new Error('R2_BUCKET_NAME is not configured')
  return new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodeR2Key(key)}`)
}

function encodeR2Key(key: string): string {
  return key.split('/').map((seg) => encodeURIComponent(seg)).join('/')
}

export async function signPresignedPutUrl(
  env: R2PresignEnv,
  key: string,
  opts: { ttlSeconds?: number; contentType?: string; contentLength?: number } = {},
): Promise<PresignedUrl> {
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS
  const url = buildR2ObjectUrl(env, key)
  url.searchParams.set('X-Amz-Expires', String(ttl))
  const headers: HeadersInit = {}
  if (opts.contentType) headers['content-type'] = opts.contentType
  if (typeof opts.contentLength === 'number') headers['content-length'] = String(opts.contentLength)
  const r2 = getR2Client(env)
  const signed = await r2.sign(new Request(url, { method: 'PUT', headers }), {
    aws: { signQuery: true },
  })
  return { url: signed.url, expiresAt: Date.now() + ttl * 1000 }
}

export async function signPresignedGetUrl(
  env: R2PresignEnv,
  key: string,
  opts: { ttlSeconds?: number } = {},
): Promise<PresignedUrl> {
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS
  const url = buildR2ObjectUrl(env, key)
  url.searchParams.set('X-Amz-Expires', String(ttl))
  const r2 = getR2Client(env)
  const signed = await r2.sign(new Request(url, { method: 'GET' }), {
    aws: { signQuery: true },
  })
  return { url: signed.url, expiresAt: Date.now() + ttl * 1000 }
}

export async function signPresignedDeleteUrl(
  env: R2PresignEnv,
  key: string,
  opts: { ttlSeconds?: number } = {},
): Promise<PresignedUrl> {
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS
  const url = buildR2ObjectUrl(env, key)
  url.searchParams.set('X-Amz-Expires', String(ttl))
  const r2 = getR2Client(env)
  const signed = await r2.sign(new Request(url, { method: 'DELETE' }), {
    aws: { signQuery: true },
  })
  return { url: signed.url, expiresAt: Date.now() + ttl * 1000 }
}

export function isR2Configured(env: Partial<R2PresignEnv>): env is R2PresignEnv {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_BUCKET_NAME && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY)
}
