import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { collectArtifacts } from '../mcp/artifact-registry'
import { persistTextArtifact } from '../agent/browser-artifact-store'
import { producerDir } from '../media-output-paths'
import { ensureArtifactDir, ensureZoneDir } from './zone-owner'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zone-owner-'))
  state.userData = root
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const owner = (sessionId: string) => readFileSync(join(root, 'sync', sessionId, '.owner'), 'utf8')

describe('zone ownership at directory creation', () => {
  it('records the owner the moment a producer directory is created, not only on a Host Action', () => {
    // The reclaim sweep only ever deletes a directory whose owner it can ask;
    // a directory nobody marked is kept forever. So every entry that creates
    // one has to say who it is for.
    ensureZoneDir(producerDir('s1', 'recording'), 'conn-1')
    expect(owner('s1')).toBe('conn-1')
    ensureZoneDir(producerDir('s2', 'browser'), null)
    expect(owner('s2')).toBe('local')
  })

  it('takes the owner from the tool call scope for a producer running inside one', async () => {
    // A remote session's tool calls carry their connection; a local session's
    // have no scope at all. Inside a call, "no scope" means local.
    await collectArtifacts('s3', 'call-1', async () => { ensureArtifactDir(producerDir('s3', 'browser')) }, 'conn-9')
    expect(owner('s3')).toBe('conn-9')
    ensureArtifactDir(producerDir('s4', 'browser'))
    expect(owner('s4')).toBe('local')
  })

  it('leaves the adhoc zone and directories outside the zone unmarked', () => {
    ensureZoneDir(producerDir(null, 'browser'), null)
    expect(existsSync(join(root, 'sync', 'adhoc', '.owner'))).toBe(false)
    const outside = join(root, 'elsewhere')
    ensureZoneDir(outside, 'conn-1')
    expect(existsSync(join(outside, '.owner'))).toBe(false)
  })

  it('marks a remote session when a browser tool spills text into its zone', async () => {
    // One real producer end to end: the store creates the directory, the
    // scope says which node the session runs on.
    await collectArtifacts('s5', 'call-2', async () => { persistTextArtifact('s5', 'spilled', 'json') }, 'conn-2')
    expect(owner('s5')).toBe('conn-2')
  })
})
