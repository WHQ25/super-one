import { describe, expect, it } from 'vitest'
import {
  manageSubagentsSummaryText,
  parseManageSubagents,
  shortenConversationId,
} from './manage-subagents-display'

const ACTIVE_LIST_OUTPUT = [
  'Created At: 2026-11-12T01:16:00+08:00',
  'Completed At: 2026-11-12T01:16:01+08:00',
  'You have 2 active subagent(s):',
  JSON.stringify([
    {
      conversationId: 'c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d',
      role: 'HarnessId Architecture Researcher',
      type: 'research',
      state: 'running',
      stateDetail: 'read_file · antigravity-protocol.ts',
      transcript: 'file:///Users/dev/.gemini/antigravity-cli/brain/c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d/.system_generated/logs/transcript.jsonl',
    },
    {
      conversationId: '92bc1f73-84fa-42e9-9157-83df2d2e33bc',
      role: 'Database Debugger',
      type: 'self',
      state: 'waiting_for_input',
    },
  ]),
].join('\n')

describe('manage-subagents-display', () => {
  it('shortens UUID conversation IDs to 8 characters while preserving compact IDs', () => {
    expect(shortenConversationId('c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d')).toBe('c1a24e86')
    expect(shortenConversationId('subagent-1')).toBe('subagent-1')
    expect(shortenConversationId('')).toBeUndefined()
    expect(shortenConversationId(undefined)).toBeUndefined()
  })

  it('parses active subagent JSON list output and strips timestamp headers', () => {
    const info = parseManageSubagents({ Action: 'list' }, ACTIVE_LIST_OUTPUT)
    expect(info.action).toBe('list')
    expect(info.declaredCount).toBe(2)
    expect(info.emptyList).toBe(false)
    expect(info.subagents).toEqual([
      {
        conversationId: 'c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d',
        shortId: 'c1a24e86',
        role: 'HarnessId Architecture Researcher',
        type: 'research',
        state: 'running',
        rawState: 'running',
        stateDetail: 'read_file · antigravity-protocol.ts',
        transcriptPath: '/Users/dev/.gemini/antigravity-cli/brain/c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d/.system_generated/logs/transcript.jsonl',
      },
      {
        conversationId: '92bc1f73-84fa-42e9-9157-83df2d2e33bc',
        shortId: '92bc1f73',
        role: 'Database Debugger',
        type: 'self',
        state: 'waiting',
        rawState: 'waiting_for_input',
      },
    ])
  })

  it('recognizes empty active subagent list and peer subagent list', () => {
    const empty = parseManageSubagents({ action: 'list' }, 'You have 0 active subagent(s):\n[]')
    expect(empty.action).toBe('list')
    expect(empty.emptyList).toBe(true)
    expect(empty.subagents).toEqual([])

    const peers = parseManageSubagents(
      {},
      [
        'You have 1 active peer subagent(s) (parent 87a2a00d-7e8c-4bd4-a4dc-8f185fc589b3):',
        JSON.stringify([
          {
            conversationId: 'c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d',
            role: 'Peer Worker',
            type: 'self',
            state: 'idle',
          },
        ]),
      ].join('\n'),
    )
    expect(peers.action).toBe('list_peers')
    expect(peers.parentConversationId).toBe('87a2a00d-7e8c-4bd4-a4dc-8f185fc589b3')
    expect(peers.shortParentId).toBe('87a2a00d')
    expect(peers.subagents).toHaveLength(1)
  })

  it('parses kill and kill_all confirmations, no-active message, and error boilerplate', () => {
    const killed = parseManageSubagents(
      { Action: 'kill_all' },
      'Successfully killed 1 subagent(s) and their descendants.\nKilled roles: HarnessId Architecture Researcher',
    )
    expect(killed.action).toBe('kill_all')
    expect(killed.killedCount).toBe(1)
    expect(killed.killedRoles).toEqual(['HarnessId Architecture Researcher'])

    const noneToKill = parseManageSubagents({ action: 'kill_all' }, 'No active subagents to kill.')
    expect(noneToKill.noActiveToKill).toBe(true)
    expect(noneToKill.killedCount).toBe(0)

    const errored = parseManageSubagents(
      { Action: 'kill', ConversationIds: ['c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d'] },
      'Encountered error in step execution: subagent "c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d" not found or not allowed to be invoked',
      true,
    )
    expect(errored.shortConversationIds).toEqual(['c1a24e86'])
    expect(errored.errorMessage).toBe(
      'subagent "c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d" not found or not allowed to be invoked',
    )
  })

  it('treats bare done/failed ACP placeholders as empty and formats compact summary text', () => {
    const legacy = parseManageSubagents(
      { Action: 'kill', ConversationIds: '["c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d"]' },
      'done',
    )
    expect(legacy.hasPlaceholderResult).toBe(true)
    expect(legacy.extraText).toBeUndefined()
    expect(legacy.shortConversationIds).toEqual(['c1a24e86'])

    expect(
      manageSubagentsSummaryText({
        action: 'kill',
        conversationIds: [
          'c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d',
          '92bc1f73-84fa-42e9-9157-83df2d2e33bc',
        ],
      }),
    ).toBe('c1a24e86 +1')
    expect(manageSubagentsSummaryText({ action: 'list' })).toBe('list')
  })
})
