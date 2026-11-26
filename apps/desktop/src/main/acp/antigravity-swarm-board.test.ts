import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readAntigravitySwarmBoard } from './antigravity-swarm-board'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('readAntigravitySwarmBoard', () => {
  it('returns null when no swarm directory exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'swarm-board-empty-'))
    tempDirs.push(root)
    expect(readAntigravitySwarmBoard('missing-session', [root])).toBeNull()
  })

  it('reads swarm.json, plan.json, members.json, board.jsonl, and active worker action', () => {
    const root = mkdtempSync(join(tmpdir(), 'swarm-board-'))
    tempDirs.push(root)
    const sessionId = 'sess-1'
    const swarmDir = join(root, sessionId, '.system_generated', 'swarm')
    mkdirSync(swarmDir, { recursive: true })

    writeFileSync(
      join(swarmDir, 'swarm.json'),
      JSON.stringify({ version: 1, backend: 'local', swarm_id: sessionId, created_at: '2026-11-26T04:39:40Z' }),
    )
    writeFileSync(
      join(swarmDir, 'plan.json'),
      JSON.stringify({
        goal: { title: 'Minimum swarm demo', line: 'Extract and verify summary.' },
        tasks: { researcher: 'Summarize package.json', reviewer: 'Verify summary' },
        threads: [{ id: 't1', title: 'Summary', tasks: ['researcher', 'reviewer'] }],
      }),
    )
    writeFileSync(
      join(swarmDir, 'members.json'),
      JSON.stringify({
        title: 'Minimum swarm demo',
        members: {
          coordinator: {
            conversation_id: sessionId,
            role: 'coordinator',
            phase: 'RUNNING',
            wake_mode: 'working',
            last_read_seq: 2,
            killed: false,
            model: 'gemini-4-hydrogen-medium',
          },
          researcher: {
            conversation_id: 'worker-1',
            role: 'worker',
            phase: 'RUNNING',
            wake_mode: 'mentions',
            wait_since: 2,
            last_read_seq: 2,
            killed: false,
            model: 'gemini-4-hydrogen-medium',
          },
          reviewer: {
            conversation_id: 'worker-2',
            role: 'worker',
            phase: 'RUNNING',
            wake_mode: 'working',
            killed: false,
            model: 'gemini-4-hydrogen-medium',
          },
        },
      }),
    )
    writeFileSync(
      join(swarmDir, 'board.jsonl'),
      [
        JSON.stringify({ seq: 1, agent: 'coordinator', text: '@researcher Summarize package.json', time: '2026-11-26 12:39:42', kind: 'brief' }),
        JSON.stringify({ seq: 2, agent: 'researcher', text: '@reviewer [done] Summary ready', time: '2026-11-26 12:39:52' }),
      ].join('\n'),
    )

    const workerLogDir = join(root, 'worker-2', '.system_generated', 'logs')
    mkdirSync(workerLogDir, { recursive: true })
    writeFileSync(
      join(workerLogDir, 'transcript.jsonl'),
      JSON.stringify({
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        tool_calls: [{ name: 'read_file', args: { Path: '/tmp/package.json' } }],
      }),
    )

    const snapshot = readAntigravitySwarmBoard(sessionId, [root])
    expect(snapshot).not.toBeNull()
    expect(snapshot!.title).toBe('Minimum swarm demo')
    expect(snapshot!.isLive).toBe(true)
    expect(snapshot!.headSeq).toBe(2)
    expect(snapshot!.messages).toHaveLength(2)
    expect(snapshot!.messages[1]?.mentions).toEqual(['reviewer'])
    expect(snapshot!.messages[1]?.isDone).toBe(true)

    const researcher = snapshot!.members.find((m) => m.name === 'researcher')
    expect(researcher?.isWorking).toBe(false)
    expect(researcher?.lastPostSeq).toBe(2)
    expect(researcher?.taskDescription).toBe('Summarize package.json')

    const reviewer = snapshot!.members.find((m) => m.name === 'reviewer')
    expect(reviewer?.isWorking).toBe(true)
    expect(reviewer?.currentAction).toContain('Read')
  })
})
