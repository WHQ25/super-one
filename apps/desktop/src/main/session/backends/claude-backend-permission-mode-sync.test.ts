import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, PermissionMode } from '@superone/shared/agent-types'
import { hoisted, makeStartOpts } from './claude-backend.fixture'
import { ClaudeBackend } from './claude-backend'

function initEvent(permissionMode: PermissionMode): AgentEvent {
  return {
    type: 'session_init',
    session: {
      sessionId: 'sdk-session',
      model: 'claude-haiku-4-5',
      tools: [],
      mcpServers: [],
      permissionMode,
      slashCommands: [],
      skills: [],
      claudeCodeVersion: '0.0.0',
      cwd: '/tmp/proj',
    },
  } as AgentEvent
}

async function startedBackend(permissionMode: PermissionMode) {
  const backend = new ClaudeBackend()
  const applied = vi.fn<(mode: PermissionMode) => void>()
  backend.onPermissionModeApplied(applied)
  await backend.start({ ...makeStartOpts(), permissionMode })
  return { backend, applied }
}

describe('ClaudeBackend follows the permission mode the CLI reports', () => {
  beforeEach(() => {
    hoisted.captured.emit = null
    hoisted.captured.createSessionQueryMock.mockClear()
  })

  // Recorded from the CLI: a haiku session started in auto reports the requested
  // mode in init, then falls back and reports default in the next status.
  it('adopts a fallback the CLI picks itself after init', async () => {
    const { applied } = await startedBackend('auto')
    hoisted.captured.emit?.(initEvent('auto'))
    hoisted.captured.emit?.({ type: 'status_indicator', indicator: null, permissionMode: 'default' })

    expect(applied.mock.calls.map(([mode]) => mode)).toEqual(['auto', 'default'])
  })

  it('revives an idle-released runtime in the reported mode', async () => {
    const { backend } = await startedBackend('auto')
    hoisted.captured.emit?.({ type: 'status_indicator', indicator: null, permissionMode: 'default' })

    hoisted.captured.iterationDone?.resolve()
    await backend.releaseRuntime('idle')
    void backend.send({ content: 'after release' })
    await new Promise((r) => setTimeout(r, 0))

    const [, opts] = hoisted.captured.createSessionQueryMock.mock.calls[1]!
    expect((opts as { permissionMode?: string }).permissionMode).toBe('default')
  })

  it('ignores status frames that carry no mode', async () => {
    const { applied } = await startedBackend('auto')
    hoisted.captured.emit?.({ type: 'status_indicator', indicator: 'compacting' })

    expect(applied).not.toHaveBeenCalled()
  })
})
