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
    // open a scope without one. Both are known; only "no scope" is not.
    await collectArtifacts('s3', 'call-1', async () => { ensureArtifactDir(producerDir('s3', 'browser')) }, 'conn-9')
    expect(owner('s3')).toBe('conn-9')
    await collectArtifacts('s4', 'call-2', async () => { ensureArtifactDir(producerDir('s4', 'browser')) })
    expect(owner('s4')).toBe('local')
  })

  it('leaves a directory unmarked, rather than calling it local, when nothing says whose call this is', () => {
    // A marker that says `local` is a deletion warrant: the sweep asks this
    // database, which has no row for a remote session, and removes the zone.
    // Outside any call scope there is no evidence either way, and an unmarked
    // directory is the one the sweep keeps.
    ensureArtifactDir(producerDir('s5', 'ios-simulator'))
    expect(existsSync(join(root, 'sync', 's5', '.owner'))).toBe(false)
  })

  it('never takes a directory away from its node once a node has been recorded', async () => {
    // The UI can capture from a device a remote session holds; that call has
    // no scope, and a local session's call must not rewrite a remote marker
    // either. A marker only ever moves towards a node, never back to local.
    ensureZoneDir(producerDir('s6', 'ios-simulator'), 'conn-1')
    ensureArtifactDir(producerDir('s6', 'ios-simulator'))
    expect(owner('s6')).toBe('conn-1')
    ensureZoneDir(producerDir('s6', 'ios-simulator'), null)
    expect(owner('s6')).toBe('conn-1')
    await collectArtifacts('s6', 'call-3', async () => { ensureArtifactDir(producerDir('s6', 'browser')) })
    expect(owner('s6')).toBe('conn-1')
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
