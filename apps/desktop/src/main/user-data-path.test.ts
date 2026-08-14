import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LEGACY_USER_DATA_DIR,
  PRODUCT_USER_DATA_DIR,
  resolveAndMigrateUserData,
} from './user-data-path'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function appData(): string {
  const root = mkdtempSync(join(tmpdir(), 'superone-user-data-'))
  tempRoots.push(root)
  return root
}

function writeFile(path: string, contents = 'data'): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}

describe('resolveAndMigrateUserData', () => {
  it('uses SuperOne when neither directory exists', () => {
    const root = appData()
    const result = resolveAndMigrateUserData({ appData: root })
    expect(result.path).toBe(join(root, PRODUCT_USER_DATA_DIR))
    expect(result.action).toBe('none')
    expect(existsSync(result.path)).toBe(false)
  })

  it('renames super-one to SuperOne when the destination is absent', () => {
    const root = appData()
    const legacy = join(root, LEGACY_USER_DATA_DIR)
    writeFile(join(legacy, 'superone.db'), 'sessions')
    writeFile(join(legacy, 'app-settings.json'), '{}')

    const result = resolveAndMigrateUserData({ appData: root })

    expect(result).toMatchObject({
      path: join(root, PRODUCT_USER_DATA_DIR),
      action: 'renamed',
    })
    expect(existsSync(legacy)).toBe(false)
    expect(readFileSync(join(result.path, 'superone.db'), 'utf8')).toBe('sessions')
    expect(readFileSync(join(result.path, 'app-settings.json'), 'utf8')).toBe('{}')
  })

  it('merges into SuperOne when it already holds the Computer Use helper', () => {
    const root = appData()
    const legacy = join(root, LEGACY_USER_DATA_DIR)
    const dest = join(root, PRODUCT_USER_DATA_DIR)
    writeFile(join(legacy, 'superone.db'), 'sessions')
    writeFile(join(legacy, 'app-settings.json'), '{"theme":"dark"}')
    writeFile(join(legacy, 'Cache', 'page'), 'cache')
    writeFile(
      join(dest, 'Computer Use', 'SuperOne Computer Use.app', 'Contents', 'Info.plist'),
      '<plist/>',
    )

    const result = resolveAndMigrateUserData({ appData: root })

    expect(result.action).toBe('merged')
    expect(result.path).toBe(dest)
    expect(existsSync(legacy)).toBe(false)
    expect(readFileSync(join(dest, 'superone.db'), 'utf8')).toBe('sessions')
    expect(readFileSync(join(dest, 'app-settings.json'), 'utf8')).toBe('{"theme":"dark"}')
    expect(readFileSync(join(dest, 'Cache', 'page'), 'utf8')).toBe('cache')
    expect(existsSync(join(dest, 'Computer Use', 'SuperOne Computer Use.app'))).toBe(true)
  })

  it('does not overwrite an already-canonical SuperOne database', () => {
    const root = appData()
    const legacy = join(root, LEGACY_USER_DATA_DIR)
    const dest = join(root, PRODUCT_USER_DATA_DIR)
    writeFile(join(legacy, 'superone.db'), 'old-sessions')
    writeFile(join(legacy, 'only-in-legacy.json'), 'keep-me')
    writeFile(join(dest, 'superone.db'), 'new-sessions')

    const result = resolveAndMigrateUserData({ appData: root })

    expect(result.action).toBe('already-canonical')
    expect(result.path).toBe(dest)
    expect(readFileSync(join(dest, 'superone.db'), 'utf8')).toBe('new-sessions')
    expect(readFileSync(join(dest, 'only-in-legacy.json'), 'utf8')).toBe('keep-me')
    expect(existsSync(join(legacy, 'superone.db'))).toBe(true)
  })

  it('treats a zero-byte SuperOne leftover db as not canonical and still merges', () => {
    const root = appData()
    const legacy = join(root, LEGACY_USER_DATA_DIR)
    const dest = join(root, PRODUCT_USER_DATA_DIR)
    writeFile(join(legacy, 'superone.db'), 'real-sessions')
    writeFile(join(dest, 'superone.db'), '')

    const result = resolveAndMigrateUserData({ appData: root })

    expect(result.action).toBe('merged')
    expect(readFileSync(join(dest, 'superone.db'), 'utf8')).toBe('real-sessions')
    expect(existsSync(legacy)).toBe(false)
  })

  it('moves instance folders under SuperOne and keeps using the instance path', () => {
    const root = appData()
    const legacy = join(root, LEGACY_USER_DATA_DIR, 'instance-lab')
    writeFile(join(legacy, 'superone.db'), 'instance-db')
    mkdirSync(join(root, PRODUCT_USER_DATA_DIR, 'Computer Use'), { recursive: true })

    const result = resolveAndMigrateUserData({ appData: root, instance: 'lab' })

    expect(result.action).toBe('renamed')
    expect(result.path).toBe(join(root, PRODUCT_USER_DATA_DIR, 'instance-lab'))
    expect(readFileSync(join(result.path, 'superone.db'), 'utf8')).toBe('instance-db')
    expect(existsSync(join(root, PRODUCT_USER_DATA_DIR, 'Computer Use'))).toBe(true)
    expect(existsSync(legacy)).toBe(false)
  })

  it('moves leftover default-instance children including instance-* on merge', () => {
    const root = appData()
    const legacy = join(root, LEGACY_USER_DATA_DIR)
    const dest = join(root, PRODUCT_USER_DATA_DIR)
    writeFile(join(legacy, 'superone.db'), 'root-db')
    writeFile(join(legacy, 'instance-lab', 'superone.db'), 'lab-db')
    mkdirSync(join(dest, 'Computer Use'), { recursive: true })

    const result = resolveAndMigrateUserData({ appData: root })

    expect(result.action).toBe('merged')
    expect(result.path).toBe(dest)
    expect(readFileSync(join(dest, 'instance-lab', 'superone.db'), 'utf8')).toBe('lab-db')
    expect(existsSync(legacy)).toBe(false)
  })

  it('keeps the legacy path when SuperOne exists as a file and cannot become userData', () => {
    const root = appData()
    const legacy = join(root, LEGACY_USER_DATA_DIR)
    writeFile(join(legacy, 'superone.db'), 'sessions')
    writeFile(join(root, PRODUCT_USER_DATA_DIR), 'not-a-directory')

    const result = resolveAndMigrateUserData({ appData: root })

    expect(result.action).toBe('kept-legacy')
    expect(result.path).toBe(legacy)
    expect(result.error).toMatch(/not a directory/i)
    expect(statSync(legacy).isDirectory()).toBe(true)
    expect(readFileSync(join(legacy, 'superone.db'), 'utf8')).toBe('sessions')
  })
})
