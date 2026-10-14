import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { awsEnv, R2_BUCKET, r2Endpoint, r2ObjectExists, readR2Object } from './r2'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

const spawn = vi.mocked(spawnSync)
const result = { pid: 1, output: [], stdout: '', stderr: '', status: 0, signal: null } as const
const KEY = 'stable/desktop-mac.yml'

beforeEach(() => {
  spawn.mockReset()
  vi.stubEnv('R2_ENDPOINT_URL', '')
  vi.stubEnv('R2_ACCOUNT_ID', 'test-account')
  vi.stubEnv('AWS_DEFAULT_REGION', undefined)
})

afterEach(() => vi.unstubAllEnvs())

describe('authenticated R2 object reads', () => {
  it('reads the object body through S3 and removes its temporary directory', () => {
    let dest = ''
    spawn.mockImplementation((_command, args) => {
      dest = String(args![args!.indexOf('--key') + 2])
      writeFileSync(dest, 'version: 0.73.0\n')
      return { ...result, output: [] }
    })
    expect(readR2Object(KEY)).toBe('version: 0.73.0\n')
    expect(spawn).toHaveBeenCalledWith('aws', [
      's3api', 'get-object', '--bucket', R2_BUCKET, '--key', KEY, dest,
      '--endpoint-url', 'https://test-account.r2.cloudflarestorage.com',
    ], expect.objectContaining({ encoding: 'utf8', env: expect.objectContaining({ AWS_DEFAULT_REGION: 'auto' }) }))
    expect(existsSync(dirname(dest))).toBe(false)
  })

  it.each(['404', 'NoSuchKey', 'NotFound'])('returns absence only for S3 code %s and cleans up', (code) => {
    spawn.mockReturnValue({ ...result, output: [], status: 1, stderr: `An error occurred (${code}) when calling the GetObject operation: Not Found` })
    expect(readR2Object(KEY)).toBeNull()
    const args = spawn.mock.calls[0]![1]!
    expect(existsSync(dirname(String(args[args.indexOf('--key') + 2])))).toBe(false)
  })

  it.each([
    'An error occurred (AccessDenied) when calling the GetObject operation: Forbidden',
    'An error occurred (403) when calling the GetObject operation: Not Found',
    'An error occurred (500) when calling the GetObject operation: Internal Server Error',
    'Could not connect to the endpoint URL',
    'Unable to locate credentials',
  ])('throws for unknown object state: %s', (stderr) => {
    spawn.mockReturnValue({ ...result, output: [], status: 1, stderr })
    expect(() => readR2Object(KEY)).toThrow(`could not read s3://${R2_BUCKET}/${KEY}: ${stderr}`)
    const args = spawn.mock.calls[0]![1]!
    expect(existsSync(dirname(String(args[args.indexOf('--key') + 2])))).toBe(false)
  })

  it('reports an unavailable AWS CLI instead of treating the object as absent', () => {
    spawn.mockReturnValue({ ...result, output: [], status: null, error: new Error('spawn aws ENOENT') })
    expect(() => readR2Object(KEY)).toThrow('aws s3api failed to run: spawn aws ENOENT')
  })
})

describe('R2 configuration and object existence', () => {
  it('supports the explicit endpoint used by set-latest', () => {
    vi.stubEnv('R2_ENDPOINT_URL', ' https://explicit.r2.cloudflarestorage.com ')
    vi.stubEnv('R2_ACCOUNT_ID', undefined)
    expect(r2Endpoint()).toBe('https://explicit.r2.cloudflarestorage.com')
  })

  it('requires a bucket endpoint instead of falling back to a public URL', () => {
    vi.stubEnv('R2_ACCOUNT_ID', undefined)
    expect(() => r2Endpoint()).toThrow(/R2_ENDPOINT_URL or R2_ACCOUNT_ID required/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('preserves an explicitly configured AWS region', () => {
    vi.stubEnv('AWS_DEFAULT_REGION', 'configured-region')
    expect(awsEnv().AWS_DEFAULT_REGION).toBe('configured-region')
  })

  it('distinguishes present, absent, and unknown for set-latest artifact checks', () => {
    spawn.mockReturnValue({ ...result, output: [] })
    expect(r2ObjectExists(KEY)).toBe(true)
    expect(spawn.mock.calls[0]![1]).toContain('head-object')
    spawn.mockReturnValue({ ...result, output: [], status: 1, stderr: 'An error occurred (404) when calling the HeadObject operation: Not Found' })
    expect(r2ObjectExists(KEY)).toBe(false)
    spawn.mockReturnValue({ ...result, output: [], status: 1, stderr: 'An error occurred (403) when calling the HeadObject operation: Forbidden' })
    expect(() => r2ObjectExists(KEY)).toThrow(/could not stat.*Forbidden/)
  })
})
