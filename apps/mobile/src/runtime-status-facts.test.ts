import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SandboxInfo } from '@superone/shared/agent-types'
import { ChatRuntime } from './runtime'

type SnapshotOverrides = {
  sandboxInfo?: SandboxInfo
  contextTokens?: number
  totalCostUsd?: number
  replay?: AgentEvent[]
}

function fakeClient(snapshot: SnapshotOverrides = {}, setSandboxResult: unknown = { ok: true }) {
  const sent: unknown[] = []
  return {
    sent,
    startBuffering() {},
    releaseBuffer() { return { epoch: 1, batches: snapshot.replay ? [snapshot.replay] : [] } },
    send: vi.fn((cmd: unknown) => { sent.push(cmd) }),
    request: vi.fn(async (cmd: { type: string }) => {
      sent.push(cmd)
      if (cmd.type === 'load_session_messages') return { messages: [], hasMore: false }
      if (cmd.type === 'get_session_state') {
        return {
          status: 'idle',
          pendingInteractions: [],
          inProgressMessages: [],
          ...(snapshot.sandboxInfo ? { sandboxInfo: snapshot.sandboxInfo } : {}),
          contextTokens: snapshot.contextTokens ?? 0,
          totalCostUsd: snapshot.totalCostUsd ?? 0,
        }
      }
      if (cmd.type === 'set_sandbox_mode') return setSandboxResult
      return { ok: true }
    }),
  }
}

describe('status-bar facts on a restored session', () => {
  it('paints context usage from the snapshot before the next turn produces any event', async () => {
    const client = fakeClient({ contextTokens: 82_400, totalCostUsd: 0.42 })
    const runtime = new ChatRuntime(client as never, () => {})
    await runtime.open('/p', 's1')

    expect(runtime.contextTokens).toBe(82_400)
    expect(runtime.totalCostUsd).toBe(0.42)
  })

  it('reports no sandbox until the host names one, rather than assuming off', async () => {
    const runtime = new ChatRuntime(fakeClient() as never, () => {})
    await runtime.open('/p', 's1')

    expect(runtime.sandboxInfo).toBeNull()
  })

  it('lets a replayed setting change override the sandbox the snapshot reported', async () => {
    const client = fakeClient({
      sandboxInfo: { enabled: false, autoAllowBash: false },
      replay: [{ type: 'agent_setting_change', patch: { sandboxInfo: { enabled: true, autoAllowBash: true } } } as AgentEvent],
    })
    const runtime = new ChatRuntime(client as never, () => {})
    await runtime.open('/p', 's1')

    expect(runtime.sandboxInfo).toEqual({ enabled: true, autoAllowBash: true })
  })
})

describe('changing the sandbox from the phone', () => {
  it('shows the requested mode immediately, then settles on what the host applied', async () => {
    const client = fakeClient({}, { sandboxInfo: { enabled: true, autoAllowBash: false } })
    const runtime = new ChatRuntime(client as never, () => {})
    await runtime.open('/p', 's1')

    const pending = runtime.setSandboxMode('auto')
    expect(runtime.sandboxInfo).toEqual({ enabled: true, autoAllowBash: true })
    await pending

    expect(runtime.sandboxInfo).toEqual({ enabled: true, autoAllowBash: false })
  })

  it('rolls the chip back to the host state and surfaces the refusal', async () => {
    const client = fakeClient({}, { error: 'sandbox unsupported on this platform', sandboxInfo: { enabled: false, autoAllowBash: false } })
    const runtime = new ChatRuntime(client as never, () => {})
    await runtime.open('/p', 's1')

    await expect(runtime.setSandboxMode('on')).rejects.toThrow('sandbox unsupported on this platform')
    expect(runtime.sandboxInfo).toEqual({ enabled: false, autoAllowBash: false })
  })
})
