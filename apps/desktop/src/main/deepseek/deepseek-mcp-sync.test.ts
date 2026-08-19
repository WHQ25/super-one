/**
 * End to end over the seam B exists for: something edits dsh's own config file
 * and a tree that is already running picks it up. The writer is the real
 * `saveDshMcpConfig`, the file is real, the watch is real — only the tree is
 * stood in for, because booting one needs Electron's userData path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveDshMcpConfig, toggleDshMcpConfig } from '@superone/runtime/fs'

const syncMcpServers = vi.fn()
let running: boolean

vi.mock('./deepseek-runtime-host', () => ({
  peekDeepseekRuntime: async () => (running ? { syncMcpServers } : null),
}))

const { readDshMcpServerSpecs, stopTrackingDshMcpConfig, trackDshMcpConfig } = await import(
  './deepseek-mcp-sync'
)

const dirs: string[] = []
// Doubles as the debounce window the watch coalesces on. 20ms held in
// isolation but not under the full suite, where 600+ concurrent files stretch
// FSEvents delivery past it.
const SETTLE_MS = 100
const CWD = '/projects/demo'

function dshHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-sync-'))
  dirs.push(home)
  return { dshHome: home, settleMs: SETTLE_MS }
}

/**
 * `fs.watch` returns before the platform watch is necessarily live — on macOS
 * the FSEvents stream starts asynchronously — so a write issued in the same
 * tick can be missed. Production never races this (the watch is armed when the
 * session starts and the user edits much later), but a test does.
 *
 * Clearing after the wait also drops any event from a write made *before*
 * tracking began, which FSEvents may deliver once the stream comes up.
 */
async function armed(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS * 2))
  syncMcpServers.mockClear()
}

/**
 * Wait for the sync to land, polling rather than sleeping a fixed span. The
 * debounce is bounded but the FSEvents delivery before it is not, so a fixed
 * wait made every positive assertion hostage to machine load.
 */
async function synced(): Promise<void> {
  const deadline = Date.now() + 5000
  while (syncMcpServers.mock.calls.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** For the negative assertions, where only elapsed time can prove a silence. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SETTLE_MS * 3))
}

beforeEach(() => {
  running = true
  syncMcpServers.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  stopTrackingDshMcpConfig()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('dsh MCP live config sync', () => {
  it('re-mounts servers when the config file gains one', async () => {
    const opts = dshHome()
    trackDshMcpConfig(CWD, opts)
    await armed()

    saveDshMcpConfig('linear', { type: 'http', url: 'https://mcp.linear.app' }, 'user', CWD, opts)
    await synced()
    // The debounce window has to close before the count is meaningful.
    await settled()

    expect(syncMcpServers).toHaveBeenCalledTimes(1)
    expect(syncMcpServers).toHaveBeenCalledWith([
      { name: 'linear', transport: 'streamable-http', url: 'https://mcp.linear.app', headers: {} },
    ])
  })

  // Disabling is the one edit that must reach a live tree promptly: the user is
  // switching a server off, and it keeps answering until the mount is gone.
  it('drops a server the user just disabled', async () => {
    const opts = dshHome()
    saveDshMcpConfig('linear', { type: 'http', url: 'https://mcp.linear.app' }, 'user', CWD, opts)
    trackDshMcpConfig(CWD, opts)
    await armed()

    toggleDshMcpConfig('linear', true, 'user', CWD, opts)
    await synced()

    expect(syncMcpServers).toHaveBeenCalledWith([])
  })

  it('does not boot a tree just because a file changed', async () => {
    const opts = dshHome()
    running = false
    trackDshMcpConfig(CWD, opts)
    await armed()

    saveDshMcpConfig('linear', { type: 'http', url: 'https://mcp.linear.app' }, 'user', CWD, opts)
    await settled()

    expect(syncMcpServers).not.toHaveBeenCalled()
  })

  it('stops watching once tracking is torn down', async () => {
    const opts = dshHome()
    trackDshMcpConfig(CWD, opts)
    await armed()
    stopTrackingDshMcpConfig()

    saveDshMcpConfig('linear', { type: 'http', url: 'https://mcp.linear.app' }, 'user', CWD, opts)
    await settled()

    expect(syncMcpServers).not.toHaveBeenCalled()
  })
})

describe('dsh MCP spec reading', () => {
  it('maps stdio servers with the session cwd and skips disabled ones', () => {
    const opts = dshHome()
    saveDshMcpConfig('local', { type: 'stdio', command: 'node', args: ['s.js'] }, 'user', CWD, opts)
    saveDshMcpConfig('off', { type: 'stdio', command: 'node' }, 'user', CWD, opts)
    toggleDshMcpConfig('off', true, 'user', CWD, opts)

    expect(readDshMcpServerSpecs(CWD, opts)).toEqual([
      { name: 'local', transport: 'stdio', command: 'node', args: ['s.js'], env: {}, cwd: CWD },
    ])
  })
})
