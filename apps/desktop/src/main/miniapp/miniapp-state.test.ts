import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MiniAppStoragePaths } from './miniapp-state'

vi.mock('electron', () => ({ app: { getPath: () => '/mock-home' } }))

const state = await import('./miniapp-state')

describe('mini-app MiniApp Host state', () => {
  let root: string
  let paths: MiniAppStoragePaths

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'superone-miniapp-state-'))
    paths = {
      workspaceStoragePath: join(root, 'workspace'),
      globalStoragePath: join(root, 'global'),
    }
  })

  afterEach(() => {
    state.closeAllMiniAppState()
    rmSync(root, { recursive: true, force: true })
  })

  it('persists JSON state independently by scope', () => {
    state.handleMiniAppStateRequest('demo', paths, 'workspace', 'update', 'settings', { density: 'compact' })
    state.handleMiniAppStateRequest('demo', paths, 'global', 'update', 'settings', { density: 'comfortable' })

    expect(state.handleMiniAppStateRequest('demo', paths, 'workspace', 'get', 'settings')).toEqual({ density: 'compact' })
    expect(state.handleMiniAppStateRequest('demo', paths, 'global', 'get', 'settings')).toEqual({ density: 'comfortable' })
    expect(state.handleMiniAppStateRequest('demo', paths, 'workspace', 'keys')).toEqual(['settings'])
  })

  it('deletes a value when update receives undefined', () => {
    state.handleMiniAppStateRequest('demo', paths, 'workspace', 'update', 'checkpoint', 3)
    state.handleMiniAppStateRequest('demo', paths, 'workspace', 'update', 'checkpoint', undefined)

    expect(state.handleMiniAppStateRequest('demo', paths, 'workspace', 'get', 'checkpoint')).toBeUndefined()
  })

  it('rejects unknown scopes instead of falling back to global state', () => {
    expect(() => state.handleMiniAppStateRequest('demo', paths, 'session' as never, 'get', 'key'))
      .toThrow('Unknown state scope')
  })
})
