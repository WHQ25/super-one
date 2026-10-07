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

/** One long-lived SDK query answering every user message, with the control methods the runner calls. */
function fakeQuery() {
  const users: SDKUserMessage[] = []
  const applyFlagSettings = vi.fn(async () => {})
  const queryFn = vi.fn((({ prompt }) => {
    const stream = (async function* () {
      for await (const user of prompt as AsyncIterable<SDKUserMessage>) {
        users.push(user)
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'sess-1', result: 'ok' } as SDKMessage
      }
    })()
    return Object.assign(stream, { mcpServerStatus: vi.fn(async () => []), applyFlagSettings })
  }) as ClaudeQueryFn)
  const optionsAt = (call: number) => (queryFn.mock.calls[call]![0] as { options: Options }).options
  return { queryFn, users, applyFlagSettings, optionsAt }
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
