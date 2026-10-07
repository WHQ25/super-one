import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeQueryFn } from '@superone/claude'
import type { AgentEvent } from '@superone/shared/agent-types'
import { createNodeClaudeTurnRunner } from './claude-turn-runner'
import type { NodeSessionRecord } from './session-runtime'

function session(): NodeSessionRecord {
  return {
    sessionId: 's1', projectId: 'p1', harnessId: 'claude', providerId: 'claude', title: null, status: 'idle',
    transcript: [], pendingInteraction: null, providerResume: null, cwd: null, createdAt: 0, updatedAt: 0,
    isPinned: false, isHidden: false, isUserRenamed: false, controllerClientSessionId: null,
    hostActionCapabilityVersion: 0, hostActionToolGroups: [], alwaysAllowedTools: [],
  }
}

/**
 * One long-lived SDK query answering every user message, with the control methods
 * the runner calls. `systemFor` yields system frames ahead of a turn's result.
 */
function fakeQuery(systemFor: (turnIndex: number) => Array<Record<string, unknown>> = () => []) {
  const users: SDKUserMessage[] = []
  const applyFlagSettings = vi.fn(async () => {})
  const setModel = vi.fn(async (_model?: string) => {})
  const setPermissionMode = vi.fn(async (_mode: string) => {})
  const queryFn = vi.fn((({ prompt }) => {
    const stream = (async function* () {
      for await (const user of prompt as AsyncIterable<SDKUserMessage>) {
        for (const system of systemFor(users.length)) yield { type: 'system', session_id: 'sess-1', ...system } as SDKMessage
        users.push(user)
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'sess-1', result: 'ok' } as SDKMessage
      }
    })()
    return Object.assign(stream, { mcpServerStatus: vi.fn(async () => []), applyFlagSettings, setModel, setPermissionMode })
  }) as ClaudeQueryFn)
  const optionsAt = (call: number) => (queryFn.mock.calls[call]![0] as { options: Options }).options
  return { queryFn, users, applyFlagSettings, setModel, setPermissionMode, optionsAt }
}

let dir = ''
let bin = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cbr-claude-turn-options-'))
  bin = join(dir, 'claude')
  writeFileSync(bin, '#!/bin/sh\n')
  chmodSync(bin, 0o755)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function runnerWith(queryFn: ClaudeQueryFn) {
  const runner = createNodeClaudeTurnRunner({ binaryPath: bin, resolveProjectPath: () => dir, queryFn, allowSimulatedFallback: false, mcpMergeMode: 'host-action-only' })
  const events: AgentEvent[] = []
  const turn = (text: string, extra: Partial<Parameters<typeof runner>[0]> = {}) => runner({
    session: session(), text, onDelta: () => {}, onAgentEvent: (event) => events.push(event),
    signal: new AbortController().signal, ...extra,
  })
  return { turn, events }
}

describe('node Claude runner: Ultracode', () => {
  it('opens the process with Ultracode and switches it in place, without a rebuild', async () => {
    const { queryFn, applyFlagSettings, optionsAt } = fakeQuery()
    const { turn, events } = runnerWith(queryFn)

    await turn('one', { ultracode: true })
    expect(optionsAt(0).settings).toMatchObject({ ultracode: true })

    await turn('two', { ultracode: false })
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(applyFlagSettings).toHaveBeenCalledExactlyOnceWith({ ultracode: false })
    expect(events).toContainEqual({ type: 'agent_setting_change', patch: { ultracode: false } })
  })

  it('leaves the process alone when a turn says nothing about it', async () => {
    const { queryFn, applyFlagSettings, optionsAt } = fakeQuery()
    const { turn } = runnerWith(queryFn)

    await turn('one')
    await turn('wake', { source: 'task-notification' })
    await turn('same', { ultracode: false })

    expect(optionsAt(0).settings).not.toHaveProperty('ultracode')
    expect(applyFlagSettings).not.toHaveBeenCalled()
  })
})

describe('node Claude runner: model, effort and permission mode', () => {
  it('switches model and mode in place, and reopens the process for an effort change', async () => {
    const { queryFn, setModel, setPermissionMode, optionsAt } = fakeQuery()
    const { turn } = runnerWith(queryFn)

    await turn('one', { model: 'opus', effort: 'high', permissionMode: 'default' })
    await turn('two', { model: 'sonnet', effort: 'high', permissionMode: 'acceptEdits' })
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(setModel).toHaveBeenCalledExactlyOnceWith('sonnet')
    expect(setPermissionMode).toHaveBeenCalledExactlyOnceWith('acceptEdits')

    await turn('three', { model: 'sonnet', effort: 'low', permissionMode: 'acceptEdits' })
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(optionsAt(1)).toMatchObject({ model: 'sonnet', effort: 'low', permissionMode: 'acceptEdits' })
  })

  // Recorded from the CLI: a haiku process opened in auto reports auto in init,
  // then falls back and reports default in the next status.
  it('tells the client the mode the CLI fell back to', async () => {
    const { queryFn } = fakeQuery((i) => i === 0
      ? [{ subtype: 'init', permissionMode: 'auto' }, { subtype: 'status', status: null, permissionMode: 'default' }]
      : [])
    const { turn, events } = runnerWith(queryFn)

    await turn('one', { model: 'haiku', permissionMode: 'auto' })

    expect(events).toContainEqual({ type: 'agent_setting_change', patch: { permissionMode: 'default' } })
  })

  it('runs in the current mode and reports it when the model refuses the requested one', async () => {
    const { queryFn, setPermissionMode } = fakeQuery()
    setPermissionMode.mockRejectedValueOnce(new Error('Cannot set permission mode to auto: auto mode unavailable for this model'))
    const { turn, events } = runnerWith(queryFn)

    await turn('one', { model: 'haiku', permissionMode: 'default' })
    await turn('two', { model: 'haiku', permissionMode: 'auto' })

    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(events).toContainEqual({ type: 'agent_setting_change', patch: { permissionMode: 'default' } })
  })
})

describe('node Claude runner: message origin', () => {
  it('stamps the user\'s own text human-typed, and a peer\'s or a host wake not', async () => {
    const { queryFn, users } = fakeQuery()
    const { turn } = runnerWith(queryFn)

    await turn('composer')
    await turn('phone', { source: 'user' })
    await turn('parent task', { source: 'collaboration' })
    await turn('peer wake', { source: 'task-notification' })

    expect(users.map((user) => (user as { origin?: unknown }).origin)).toEqual([
      { kind: 'human' }, { kind: 'human' }, undefined, undefined,
    ])
  })
})
