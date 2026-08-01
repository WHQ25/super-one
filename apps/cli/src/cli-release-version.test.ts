import { afterEach, describe, expect, it } from 'vitest'
import { resolveCliReleaseVersion } from './cli-release-version'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const prev = process.env.SUPERONE_CLI_VERSION

afterEach(() => {
  if (prev === undefined) delete process.env.SUPERONE_CLI_VERSION
  else process.env.SUPERONE_CLI_VERSION = prev
})

describe('resolveCliReleaseVersion', () => {
  it('prefers SUPERONE_CLI_VERSION env override', () => {
    process.env.SUPERONE_CLI_VERSION = '9.9.9-test'
    expect(resolveCliReleaseVersion()).toBe('9.9.9-test')
  })

  it('falls back to monorepo package.json version in dev', () => {
    delete process.env.SUPERONE_CLI_VERSION
    const root = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../../package.json'), 'utf8'),
    ) as { version: string }
    expect(resolveCliReleaseVersion()).toBe(root.version)
  })
})
