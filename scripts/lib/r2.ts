import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const R2_BUCKET = process.env.R2_BUCKET?.trim() || 'super-one-releases'

export function r2Endpoint(): string {
  const endpoint = process.env.R2_ENDPOINT_URL?.trim()
  if (endpoint) return endpoint
  const accountId = process.env.R2_ACCOUNT_ID?.trim()
  if (!accountId) throw new Error('R2_ENDPOINT_URL or R2_ACCOUNT_ID required for bucket access')
  return `https://${accountId}.r2.cloudflarestorage.com`
}

export function requireR2Credentials(): void {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY required for bucket access')
  }
}

export function awsEnv(): NodeJS.ProcessEnv {
  return { ...process.env, AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION ?? 'auto' }
}

function awsS3Api(args: string[]): { status: number; stderr: string } {
  const res = spawnSync('aws', ['s3api', ...args, '--endpoint-url', r2Endpoint()], {
    encoding: 'utf8',
    env: awsEnv(),
  })
  if (res.error) throw new Error(`aws s3api failed to run: ${res.error.message}`)
  return { status: res.status ?? 1, stderr: (res.stderr ?? '').trim() }
}

/** Only an S3 missing-key code means absent; auth/network failures mean unknown. */
function isMissingKeyError(stderr: string): boolean {
  return /\((?:404|NoSuchKey|NotFound)\)/i.test(stderr)
}

export function r2ObjectExists(key: string): boolean {
  const res = awsS3Api(['head-object', '--bucket', R2_BUCKET, '--key', key])
  if (res.status === 0) return true
  if (isMissingKeyError(res.stderr)) return false
  throw new Error(`could not stat s3://${R2_BUCKET}/${key}: ${res.stderr || `aws exited ${res.status}`}`)
}

/**
 * Read authoritative pointer state through authenticated S3, never the CDN.
 * Public edges can deny runner reads or serve stale data. Neither is evidence
 * that a pointer is absent: returning null is safe only for an S3 missing key.
 * The AWS CLI uses the caller's credentials, including profiles in set-latest.
 */
export function readR2Object(key: string): string | null {
  const scratch = mkdtempSync(join(tmpdir(), 'superone-r2-'))
  const out = join(scratch, 'object')
  try {
    const res = awsS3Api(['get-object', '--bucket', R2_BUCKET, '--key', key, out])
    if (res.status === 0) return readFileSync(out, 'utf8')
    if (isMissingKeyError(res.stderr)) return null
    throw new Error(`could not read s3://${R2_BUCKET}/${key}: ${res.stderr || `aws exited ${res.status}`}`)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
