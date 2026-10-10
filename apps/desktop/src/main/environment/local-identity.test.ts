import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadDesktopEnvironmentIdentity } from './local-identity'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'superone-env-id-'))
  dirs.push(dir)
  return dir
}

const nodeIdFile = (dir: string) => join(dir, 'node-host', 'environment-id')

describe('loadDesktopEnvironmentIdentity', () => {
  it('creates one stable id as the node identity and reuses it', () => {
    const dir = tempDir()
    const a = loadDesktopEnvironmentIdentity(dir)
    expect(a.environmentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(loadDesktopEnvironmentIdentity(dir)).toEqual(a)
    expect(readFileSync(nodeIdFile(dir), 'utf8').trim()).toBe(a.environmentId)
    expect(a.aliases).toEqual([])
  })

  it('makes a desktop without a node identity keep its local id', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'environment-id'), 'local-id\n')
    expect(loadDesktopEnvironmentIdentity(dir)).toEqual({ environmentId: 'local-id', aliases: [] })
    expect(readFileSync(nodeIdFile(dir), 'utf8').trim()).toBe('local-id')
  })

  it('keeps the node id for a desktop that has both, with the local id as its alias', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'environment-id'), 'local-id\n')
    mkdirSync(join(dir, 'node-host'))
    writeFileSync(nodeIdFile(dir), 'node-id\n')
    expect(loadDesktopEnvironmentIdentity(dir)).toEqual({ environmentId: 'node-id', aliases: ['local-id'] })
  })

  it('treats blank files as missing', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'environment-id'), '   \n')
    const { environmentId } = loadDesktopEnvironmentIdentity(dir)
    expect(environmentId.length).toBeGreaterThan(0)
    expect(readFileSync(nodeIdFile(dir), 'utf8').trim()).toBe(environmentId)
  })
})
