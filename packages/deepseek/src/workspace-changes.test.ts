import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekRuntime } from './runtime'
import { TEST_PRESET_OPTIONS } from './test-presets'
import { useToolCallAdapter } from './test-adapters'
import { fileToolPath } from './workspace-changes'

describe('fileToolPath', () => {
  it('names the file a write, edit or mutating str_replace_editor call changes', () => {
    expect(fileToolPath('write', '{"file_path":"a.txt","content":"x"}')).toBe('a.txt')
    expect(fileToolPath('edit', '{"file_path":"/abs/b.ts","old_string":"a","new_string":"b"}')).toBe('/abs/b.ts')
    expect(fileToolPath('str_replace_editor', '{"command":"create","path":"c.md"}')).toBe('c.md')
  })

  it('ignores every other call and unreadable arguments', () => {
    expect(fileToolPath('bash', '{"command":"touch a"}')).toBeUndefined()
    expect(fileToolPath('write', 'not json')).toBeUndefined()
    expect(fileToolPath('write', '{"content":"x"}')).toBeUndefined()
  })
})

const dirs: string[] = []
const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (disposers.length) await disposers.pop()?.().catch(() => undefined)
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** A committed repository, so the recorder takes git snapshots. */
function repository(): string {
  // Real path: the recorder canonicalizes (macOS `/var` → `/private/var`).
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-workspace-')))
  dirs.push(cwd)
  const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' })
  git('init', '-q')
  writeFileSync(join(cwd, 'seed.txt'), 'one\ntwo\n')
  git('add', '.')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'seed')
  return cwd
}

async function session(cwd: string) {
  const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS, persona: 'test agent' })
  disposers.push(() => runtime.dispose())
  useToolCallAdapter(runtime)
  const events: AgentEvent[] = []
  const agent = await runtime.createAgent({
    sessionId: randomUUID(),
    cwd,
    provider: 'mock',
    model: 'mock-1',
    onEvent: (event) => events.push(event),
    toolPlane: { requestPermission: async () => 'allowed-once' },
  })
  disposers.push(() => agent.dispose())
  return {
    events,
    async run(text: string) {
      await agent.sendText(text)
      await new Promise((resolve) => setTimeout(resolve, 50))
      await agent.whenIdle()
    },
  }
}

type ToolUse = Extract<Extract<AgentEvent, { type: 'content_delta' }>['delta'], { type: 'tool_use' }>

/** One entry per row: a streamed call and its completion share an id. */
function toolUses(events: AgentEvent[]): ToolUse[] {
  const rows = new Map<string, ToolUse>()
  for (const event of events) {
    if (event.type === 'content_delta' && event.delta.type === 'tool_use') rows.set(event.delta.toolUseId, event.delta as ToolUse)
  }
  return [...rows.values()]
}

describe('workspace changes in the transcript', () => {
  it('renders files a shell command changed as edit rows inside the turn', async () => {
    const cwd = repository()
    const s = await session(cwd)

    await s.run('CALL bash {"command":"printf one-changed\\\\\\\\n > seed.txt && echo hi > note.txt","description":"Edit files"}')

    const rows = toolUses(s.events).filter((row) => row.toolUseId.includes('#workspace'))
    expect(rows.map((row) => [row.toolName, row.toolFilePath])).toEqual([
      ['Write', join(cwd, 'note.txt')],
      ['Edit', join(cwd, 'seed.txt')],
    ])
    expect(rows[1]?.toolLineDelta).toEqual({ added: 1, removed: 2 })
    // Inside the turn: the rows precede the message's completion.
    const complete = s.events.findIndex((event) => event.type === 'message_complete')
    const lastRow = s.events.findLastIndex((event) => event.type === 'content_delta' && event.delta.type === 'tool_use')
    expect(lastRow).toBeLessThan(complete)
  })

  it('leaves a file the write tool changed to its own row', async () => {
    const cwd = repository()
    const s = await session(cwd)

    await s.run('CALL write {"file_path":"made.txt","content":"x"}')

    expect(toolUses(s.events).map((row) => row.toolName)).toEqual(['Write'])
  })
})
