import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const REPO_ROOT = resolve(import.meta.dirname, '..')
let scratch: string

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'release-mobile-preflight-test-'))
  // Exercise the real Bun entrypoint with a denied public read and a fake S3
  // boundary. No test can contact R2 or queue an EAS build.
  writeFileSync(join(scratch, 'public-403.ts'), `
    import { appendFileSync } from 'node:fs'
    globalThis.fetch = async () => {
      appendFileSync(process.env.FAKE_PUBLIC_CALLS!, 'fetch\\n')
      return new Response('Forbidden', { status: 403 })
    }
  `)
  writeFileSync(join(scratch, 'aws'), `#!${process.execPath}
    const { appendFileSync, writeFileSync } = require('node:fs')
    const args = process.argv.slice(2)
    appendFileSync(process.env.FAKE_AWS_CALLS, JSON.stringify(args) + '\\n')
    if (process.env.FAKE_AWS_ERROR) {
      console.error(process.env.FAKE_AWS_ERROR)
      process.exit(1)
    }
    let dest
    for (let i = 2; i < args.length; i++) {
      if (args[i].startsWith('--')) i++
      else dest = args[i]
    }
    writeFileSync(dest, process.env.FAKE_MANIFEST)
  `, { mode: 0o755 })
})

afterEach(() => rmSync(scratch, { recursive: true, force: true }))

function runScript(args: string[], overrides: NodeJS.ProcessEnv = {}) {
  return spawnSync('bun', [
    '--preload', join(scratch, 'public-403.ts'),
    ...args,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${scratch}:${process.env.PATH}`,
      AWS_ACCESS_KEY_ID: 'test-access-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret-key',
      AWS_DEFAULT_REGION: 'auto',
      R2_ACCOUNT_ID: 'test-account',
      R2_ENDPOINT_URL: '',
      R2_BUCKET: '',
      FAKE_AWS_CALLS: join(scratch, 'aws-calls'),
      FAKE_PUBLIC_CALLS: join(scratch, 'public-calls'),
      FAKE_MANIFEST: 'version: 0.73.0\n',
      FAKE_AWS_ERROR: '',
      ...overrides,
    },
  })
}

function checkFloor(overrides: NodeJS.ProcessEnv = {}) {
  return runScript(['scripts/publish-mobile-update.ts', '--check-stable-floor'], overrides)
}

describe('stable mobile release preflight', () => {
  it.each(['0.73.0', '"0.73.0"', "'0.73.0'"])(
    'checks the authenticated stable desktop %s even when the public CDN rejects reads',
    (version) => {
      const res = checkFloor({ FAKE_MANIFEST: `version: ${version}\n` })
      expect(res.error).toBeUndefined()
      expect(res.status, res.stderr).toBe(0)
      expect(res.stdout).toContain('ok: stable desktop 0.73.0 serves phones requiring')
      expect(existsSync(join(scratch, 'public-calls'))).toBe(false)
      const [args] = readFileSync(join(scratch, 'aws-calls'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
      expect(args).toEqual(expect.arrayContaining([
        's3api', 'get-object', '--bucket', 'super-one-releases',
        '--key', 'stable/desktop-mac.yml', '--endpoint-url',
        'https://test-account.r2.cloudflarestorage.com',
      ]))
    },
  )

  it('still refuses a stable desktop below MIN_PHONE_DESKTOP_VERSION', () => {
    const res = checkFloor({ FAKE_MANIFEST: 'version: 0.72.2\n' })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/requires desktop .* but stable desktop is 0\.72\.2/)
    expect(res.stdout).not.toContain('ok:')
  })

  it('refuses a stable desktop feed that has never been published', () => {
    const res = checkFloor({ FAKE_AWS_ERROR: 'An error occurred (NoSuchKey) when calling the GetObject operation: Not Found' })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/stable\/desktop-mac\.yml.*not published/)
  })

  it('fails closed on an authenticated 403 without falling back to the CDN', () => {
    const res = checkFloor({ FAKE_AWS_ERROR: 'An error occurred (AccessDenied) when calling the GetObject operation: Forbidden' })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('AccessDenied')
    expect(existsSync(join(scratch, 'public-calls'))).toBe(false)
  })

  it('refuses a feed with no version', () => {
    const res = checkFloor({ FAKE_MANIFEST: 'files: []\n' })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/stable\/desktop-mac\.yml.*no version/)
  })

  it('requires credentials before attempting a read', () => {
    const res = checkFloor({ AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '' })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY required')
    expect(existsSync(join(scratch, 'aws-calls'))).toBe(false)
    expect(existsSync(join(scratch, 'public-calls'))).toBe(false)
  })

  it('accepts the explicit endpoint configuration used by set-latest', () => {
    const res = checkFloor({ R2_ACCOUNT_ID: '', R2_ENDPOINT_URL: 'https://explicit.r2.cloudflarestorage.com' })
    expect(res.status, res.stderr).toBe(0)
    expect(readFileSync(join(scratch, 'aws-calls'), 'utf8')).toContain('https://explicit.r2.cloudflarestorage.com')
  })
})

describe('other release pointer readers', () => {
  it('inherits the published mobile floor through the shared object reader', () => {
    const res = runScript([
      'scripts/publish-mobile-update.ts', '--platform', 'ios', '--version', '1.0.0',
      '--build-code', '37', '--testflight-url', 'https://testflight.apple.com/join/abcd1234',
      '--out', join(scratch, 'staging'),
    ], {
      FAKE_MANIFEST: JSON.stringify({
        schemaVersion: 1, platform: 'ios', version: '1.0.0', buildCode: 36,
        minSupportedBuildCode: 30, releasedAt: '2026-10-14T00:00:00.000Z',
        testflightUrl: 'https://testflight.apple.com/join/abcd1234',
      }),
    })
    expect(res.status, res.stderr).toBe(0)
    const manifest = JSON.parse(readFileSync(join(scratch, 'staging/mobile/ios/latest.json'), 'utf8'))
    expect(manifest.minSupportedBuildCode).toBe(30)
    expect(readFileSync(join(scratch, 'aws-calls'), 'utf8')).toContain('mobile/ios/latest.json')
    expect(existsSync(join(scratch, 'public-calls'))).toBe(false)
  })

  it('keeps the set-latest semver guard when the public read is denied', () => {
    writeFileSync(join(scratch, 'desktop-mac.yml'), 'version: 0.73.0\nfiles:\n  - url: SuperOne-0.73.0.dmg\n')
    const res = runScript([
      'scripts/set-latest.ts', 'v0.73.0', 'stable', 'false', scratch,
      'https://dl.super-one.dev', join(scratch, 'out'), join(scratch, 'plan.json'),
    ], { FAKE_MANIFEST: 'version: 0.74.0\n', R2_ENDPOINT_URL: 'https://explicit.r2.cloudflarestorage.com' })
    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain('live 0.74.0 is newer than 0.73.0')
    expect(existsSync(join(scratch, 'out/stable/desktop-mac.yml'))).toBe(false)
    expect(JSON.parse(readFileSync(join(scratch, 'plan.json'), 'utf8'))).toEqual([])
    expect(existsSync(join(scratch, 'public-calls'))).toBe(false)
  })
})

describe('release-mobile workflow preflight placement', () => {
  const workflow = parse(readFileSync(join(REPO_ROOT, '.github/workflows/release-mobile.yml'), 'utf8'))

  it.each(['android', 'ios'])('authenticates the %s floor check before EAS or TestFlight', (platform) => {
    const steps = workflow.jobs[platform].steps
    const index = steps.findIndex((step: { name?: string }) => step.name === 'Check the stable desktop floor')
    expect(index).toBeGreaterThanOrEqual(0)
    expect(steps[index].run).toBe('bun scripts/publish-mobile-update.ts --check-stable-floor')
    expect(steps[index].if).toBe("${{ env.TRACK == 'stable' && inputs.build_id == '' }}")
    expect(steps[index].env).toMatchObject({
      AWS_ACCESS_KEY_ID: '${{ secrets.R2_ACCESS_KEY_ID }}',
      AWS_SECRET_ACCESS_KEY: '${{ secrets.R2_SECRET_ACCESS_KEY }}',
      AWS_DEFAULT_REGION: 'auto',
      R2_ACCOUNT_ID: '${{ secrets.R2_ACCOUNT_ID }}',
    })
    const buildIndex = steps.findIndex((step: { id?: string }) => step.id === 'build')
    expect(buildIndex).toBeGreaterThan(index)
    if (platform === 'ios') {
      const submitIndex = steps.findIndex((step: { name?: string }) => step.name === 'Submit to TestFlight')
      expect(submitIndex).toBeGreaterThan(index)
    }
  })
})
