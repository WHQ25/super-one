import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MANAGED_CURRENT_BASENAME,
  managedVersionDir,
  pruneManagedVersions,
  readCurrentPointer,
  resolveActiveInstallRoot,
  sanitizeRuntimeVersionForPath,
  writeCurrentPointer,
} from './managed-layout'

describe('sanitizeRuntimeVersionForPath', () => {
  it('accepts npm-style pins', () => {
    expect(sanitizeRuntimeVersionForPath('0.3.226')).toBe('0.3.226')
    expect(sanitizeRuntimeVersionForPath('0.146.1-darwin-arm64')).toBe('0.146.1-darwin-arm64')
  })

  it('rejects traversal', () => {
    expect(() => sanitizeRuntimeVersionForPath('../x')).toThrow(/unsafe/)
    expect(() => sanitizeRuntimeVersionForPath('a/b')).toThrow(/unsafe/)
  })
})

describe('current pointer + resolve', () => {
  let prefix: string

  beforeEach(() => {
    prefix = mkdtempSync(join(tmpdir(), 'so-layout-'))
  })

  afterEach(() => {
    rmSync(prefix, { recursive: true, force: true })
  })

  it('writes canonical current and reads it back', () => {
    writeCurrentPointer(prefix, '1.2.3')
    expect(readCurrentPointer(prefix)).toMatchObject({ runtimeVersion: '1.2.3' })
    expect(existsSync(join(prefix, MANAGED_CURRENT_BASENAME))).toBe(true)
    expect(resolveActiveInstallRoot(prefix)).toBeNull()

    const dir = managedVersionDir(prefix, '1.2.3')
    mkdirSync(dir, { recursive: true })
    expect(resolveActiveInstallRoot(prefix)).toBe(dir)
  })

  it('prunes old versions beyond keep set', () => {
    for (const v of ['a', 'b', 'c', 'd']) {
      const d = managedVersionDir(prefix, v)
      mkdirSync(d, { recursive: true })
      writeFileSync(join(d, 'marker'), v)
    }
    writeCurrentPointer(prefix, 'd')
    pruneManagedVersions(prefix, ['d', 'c'], 2)

    const left = readdirSync(join(prefix, 'versions')).sort()
    expect(left).toEqual(['c', 'd'])
  })
})
