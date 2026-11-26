import { describe, expect, it } from 'vitest'
import {
  extractParentSubagentTranscriptState,
  parseAntigravitySubagentTranscript,
} from './antigravity-subagent-transcript'

describe('antigravity swarm subagent transcript parsing', () => {
  it('extracts conversation_id and swarmName from swarm add output', () => {
    const raw = [
      JSON.stringify({
        step_index: 5,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        tool_calls: [{ name: 'swarm', args: { action: 'add', name: 'researcher', brief: 'Read package.json' } }],
      }),
      JSON.stringify({
        step_index: 6,
        type: 'GENERIC',
        status: 'DONE',
        created_at: '2026-11-26T04:39:42Z',
        content:
          'Created At: 2026-11-26T12:39:35+08:00\nCompleted At: 2026-11-26T12:39:42+08:00\n' +
          JSON.stringify({
            status: 'added',
            name: 'researcher',
            model: 'gemini-4-hydrogen-medium',
            conversation_id: 'c2f86f31-ca96-41a1-9023-2d5f936d08e7',
          }),
      }),
    ].join('\n')

    const state = extractParentSubagentTranscriptState(raw)
    expect(state.spawned).toHaveLength(1)
    expect(state.spawned[0]?.conversationId).toBe('c2f86f31-ca96-41a1-9023-2d5f936d08e7')
    expect(state.spawned[0]?.swarmName).toBe('researcher')
  })

  it('marks swarm worker parked on swarm_wait as completed and extracts post_message text', () => {
    const raw = [
      JSON.stringify({
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-26T04:39:42Z',
        input_tokens: 1000,
        output_tokens: 100,
        tool_calls: [{ name: 'read_file', args: { Path: '/tmp/package.json' } }],
      }),
      JSON.stringify({
        step_index: 3,
        type: 'GENERIC',
        status: 'DONE',
        created_at: '2026-11-26T04:39:46Z',
        content: '{"name":"super-one"}',
      }),
      JSON.stringify({
        step_index: 5,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-26T04:39:46Z',
        input_tokens: 1200,
        output_tokens: 200,
        tool_calls: [
          { name: 'post_message', args: { text: '@reviewer Summary ready' } },
          { name: 'swarm_wait', args: { since: 3 } },
        ],
      }),
      JSON.stringify({
        step_index: 6,
        type: 'GENERIC',
        status: 'DONE',
        created_at: '2026-11-26T04:39:52Z',
        content: '{"status":"posted","seq":4}',
      }),
      JSON.stringify({
        step_index: 7,
        type: 'GENERIC',
        status: 'DONE',
        created_at: '2026-11-26T04:39:52Z',
        content: 'Waiting for a message that calls on you by name, or on @all posted after #4.',
      }),
    ].join('\n')

    const parsed = parseAntigravitySubagentTranscript(raw)
    expect(parsed.completed).toBe(true)
    expect(parsed.failed).toBe(false)
    expect(parsed.resultText).toBe('@reviewer Summary ready')
    expect(parsed.toolUses).toBe(3)
  })
})
