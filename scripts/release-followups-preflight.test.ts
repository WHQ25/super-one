import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = resolve(import.meta.dirname, '..')
const version = '0.74.0-alpha.2'
let scratch: string

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'release-followups-test-'))
  writeFileSync(join(scratch, 'gh'), `#!${process.execPath}
    console.log(process.env.FAKE_RELEASE)
  `, { mode: 0o755 })
  writeFileSync(join(scratch, 'git'), `#!${process.execPath}
    console.log(process.argv.includes('HEAD') ? process.env.FAKE_HEAD_SHA : '${'a'.repeat(40)}')
  `, { mode: 0o755 })
  writeFileSync(join(scratch, 'aws'), `#!${process.execPath}
    const { writeFileSync } = require('node:fs')
    if (process.env.FAKE_AWS_ERROR) { console.error(process.env.FAKE_AWS_ERROR); process.exit(1) }
    const args = process.argv.slice(2), keyIndex = args.indexOf('--key')
    const key = args[keyIndex + 1], dest = args[keyIndex + 2]
    const version = key.endsWith('/latest.yml') && process.env.FAKE_WIN_VERSION || '${version}'
    writeFileSync(dest, 'version: ' + version + '\\n')
  `, { mode: 0o755 })
})

afterEach(() => rmSync(scratch, { recursive: true, force: true }))

function preflight(overrides: NodeJS.ProcessEnv = {}) {
  return spawnSync('bun', ['scripts/release-followups-preflight.ts', `v${version}`, 'alpha'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${scratch}:${process.env.PATH}`,
      AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test',
      R2_ENDPOINT_URL: 'https://test.r2.cloudflarestorage.com',
      GITHUB_OUTPUT: join(scratch, 'outputs'),
      FAKE_RELEASE: JSON.stringify({ tagName: `v${version}`, isDraft: false, isPrerelease: true }),
      FAKE_AWS_ERROR: '', FAKE_WIN_VERSION: '',
      FAKE_HEAD_SHA: 'a'.repeat(40),
      ...overrides,
    },
  })
}

describe('desktop publication before release follow-ups', () => {
  it('keeps desktop build cancellation from leaving CLI, harness or relay publications', () => {
    const workflow = parse(readFileSync(join(root, '.github/workflows/release.yml'), 'utf8'))
    const publishers = Object.values(workflow.jobs).filter((job: any) =>
      /publish-cli|publish-harness|deploy-relay|update-mobile/.test(job.uses ?? ''))
    expect(publishers).toEqual([])
  })

  it('requires the desktop gate and its exact commit for every follow-up publisher', () => {
    const workflow = parse(readFileSync(join(root, '.github/workflows/release-followups.yml'), 'utf8'))
    for (const name of ['publish-cli', 'publish-harness', 'deploy-relay', 'mobile-ota']) {
      expect(workflow.jobs[name].needs).toBe('ready')
      expect(workflow.jobs[name].with.ref).toBe('${{ needs.ready.outputs.sha }}')
    }
    expect(workflow.jobs.ready.steps.some((step: any) => step.run?.includes('release-followups-preflight.ts'))).toBe(true)
  })

  it('rejects a draft even if archive artifacts exist', () => {
    const res = preflight({ FAKE_RELEASE: JSON.stringify({ tagName: `v${version}`, isDraft: true, isPrerelease: true }) })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('must be published')
  })

  it('refuses a different checkout from the published desktop tag', () => {
    const res = preflight({ FAKE_HEAD_SHA: 'b'.repeat(40) })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('checkout must match')
  })

  it('rejects a partially updated desktop when Windows still points at the old release', () => {
    const res = preflight({ FAKE_WIN_VERSION: '0.74.0-alpha' })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('alpha/latest.yml')
  })

  it('fails closed when authoritative desktop state cannot be read', () => {
    const res = preflight({ FAKE_AWS_ERROR: 'An error occurred (AccessDenied)' })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('AccessDenied')
  })

  it('returns the version and checked-out tag commit only after all desktop feeds match', () => {
    const res = preflight()
    expect(res.status, res.stderr).toBe(0)
    const outputs = readFileSync(join(scratch, 'outputs'), 'utf8')
    expect(outputs).toContain(`version=${version}\n`)
    expect(outputs).toContain('npm_tag=alpha\n')
    expect(outputs).toMatch(/sha=[a-f0-9]{40}\n/)
  })
})
