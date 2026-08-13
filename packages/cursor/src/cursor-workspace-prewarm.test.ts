import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prewarmLocalWorkspace = vi.fn()
const createAgentPlatform = vi.fn(async () => ({ prewarmLocalWorkspace }))

vi.mock('@cursor/sdk', () => ({
  createAgentPlatform: () => createAgentPlatform(),
}))

import {
  prewarmCursorLocalWorkspace,
  resetCursorWorkspacePrewarmForTests,
} from './cursor-workspace-prewarm'
import type { CursorRuntimeOptions } from './cursor-runtime'

function makeOpts(overrides: Partial<CursorRuntimeOptions> = {}): CursorRuntimeOptions {
  return {
    sessionId: 's1',
    cwd: '/repo',
    userDataRoot: '/tmp/user',
    permissionMode: 'auto',
    sandboxEnabled: false,
    config: { apiKey: 'cursor_test_key' },
    onEvent: () => undefined,
    ...overrides,
  }
}

describe('prewarmCursorLocalWorkspace', () => {
  beforeEach(async () => {
    await resetCursorWorkspacePrewarmForTests()
    prewarmLocalWorkspace.mockReset()
    createAgentPlatform.mockClear()
    prewarmLocalWorkspace.mockResolvedValue(async () => undefined)
  })

  afterEach(async () => {
    await resetCursorWorkspacePrewarmForTests()
  })

  it('calls official prewarmLocalWorkspace with matching workspace options', async () => {
    await prewarmCursorLocalWorkspace(makeOpts({
      sandboxEnabled: false,
      permissionMode: 'auto',
      buildMcpServers: () => ({
        superone: { type: 'http', url: 'http://127.0.0.1:9/mcp' },
      }),
    }))

    expect(createAgentPlatform).toHaveBeenCalledTimes(1)
    expect(prewarmLocalWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'cursor_test_key',
      mcpServers: { superone: { type: 'http', url: 'http://127.0.0.1:9/mcp' } },
      local: expect.objectContaining({
        cwd: '/repo',
        settingSources: ['project', 'user'],
        sandboxOptions: { enabled: false },
        autoReview: true,
        enableAgentRetries: true,
      }),
    }))
  })

  it('does not acquire a second lease for the same workspace key', async () => {
    await prewarmCursorLocalWorkspace(makeOpts())
    await prewarmCursorLocalWorkspace(makeOpts())
    expect(prewarmLocalWorkspace).toHaveBeenCalledTimes(1)
  })

  it('releases the previous lease when cwd changes', async () => {
    const firstRelease = vi.fn(async () => undefined)
    prewarmLocalWorkspace.mockResolvedValueOnce(firstRelease)
    await prewarmCursorLocalWorkspace(makeOpts({ cwd: '/a' }))
    await prewarmCursorLocalWorkspace(makeOpts({ cwd: '/b' }))
    expect(prewarmLocalWorkspace).toHaveBeenCalledTimes(2)
    expect(firstRelease).toHaveBeenCalledTimes(1)
  })

  it('skips cloud agents and missing API keys', async () => {
    await prewarmCursorLocalWorkspace(makeOpts({
      providerSessionId: 'bc-cloud',
      config: { apiKey: 'cursor_test_key', runtime: 'cloud' },
    }))
    await prewarmCursorLocalWorkspace(makeOpts({ config: {} }))
    expect(prewarmLocalWorkspace).not.toHaveBeenCalled()
  })

  it('traces official prewarm start/ready and later held keepalive', async () => {
    const onSdkTrace = vi.fn()
    await prewarmCursorLocalWorkspace(makeOpts({ onSdkTrace }))
    await prewarmCursorLocalWorkspace(makeOpts({ onSdkTrace }))
    expect(onSdkTrace).toHaveBeenCalledWith(
      'cursor.runtime',
      'prewarm_start',
      expect.objectContaining({ cwd: '/repo' }),
      's1',
    )
    expect(onSdkTrace).toHaveBeenCalledWith(
      'cursor.runtime',
      'prewarm_ready',
      expect.objectContaining({ cwd: '/repo' }),
      's1',
    )
    expect(onSdkTrace).toHaveBeenCalledWith(
      'cursor.runtime',
      'prewarm_held',
      expect.objectContaining({ cwd: '/repo' }),
      's1',
    )
  })
})
