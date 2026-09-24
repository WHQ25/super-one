import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekRuntime } from './runtime'
import { TEST_PRESET_OPTIONS } from './test-presets'
import { useToolCallAdapter } from './test-adapters'

const dirs: string[] = []
const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (disposers.length) await disposers.pop()?.().catch(() => undefined)
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function session() {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-jobs-'))
  dirs.push(cwd)
  const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS, persona: 'test agent' })
  disposers.push(() => runtime.dispose())
  useToolCallAdapter(runtime)
  const sessionId = randomUUID()
  const events: AgentEvent[] = []
  const agent = await runtime.createAgent({
    sessionId,
    cwd,
    provider: 'mock',
    model: 'mock-1',
    onEvent: (event) => events.push(event),
    toolPlane: { requestPermission: async () => 'allowed-once' },
  })
  disposers.push(() => agent.dispose())
  return {
    runtime,
    sessionId,
    events,
    async run(text: string) {
      await agent.sendText(text)
      await new Promise((resolve) => setTimeout(resolve, 50))
      await agent.whenIdle()
    },
  }
}

function taskEvents(events: AgentEvent[]) {
  return events.filter((event) => event.type === 'task_started' || event.type === 'task_notification')
}

describe('dsh background jobs as tasks', () => {
  it('tracks a background command as a task of its bash call until it finishes', async () => {
    const s = await session()

    await s.run('CALL bash {"command":"sleep 0.3","description":"Wait","run_in_background":true}')

    const started = s.events.find((event) => event.type === 'task_started')
    const call = s.events.find((event) => event.type === 'content_delta' && event.delta.type === 'tool_use')
    expect(started?.type === 'task_started' ? started.toolUseId : null)
      .toBe(call?.type === 'content_delta' && call.delta.type === 'tool_use' ? call.delta.toolUseId : 'none')
    expect(s.runtime.hasBackgroundWork(s.sessionId)).toBe(true)
    await vi.waitFor(() => expect(s.events).toContainEqual(expect.objectContaining({
      type: 'task_notification',
      taskStatus: 'completed',
    })))
    expect(s.runtime.hasBackgroundWork(s.sessionId)).toBe(false)
  })

  it('leaves a foreground command out of the task list', async () => {
    const s = await session()

    await s.run('CALL bash {"command":"true","description":"Nothing"}')

    expect(taskEvents(s.events)).toEqual([])
  })

  it('kills a background command stopped from its task', async () => {
    const s = await session()
    await s.run('CALL bash {"command":"sleep 30","description":"Wait","run_in_background":true}')
    const started = s.events.find((event) => event.type === 'task_started')

    expect(s.runtime.stopTask(s.sessionId, started?.type === 'task_started' ? started.taskId : '')).toBe(true)

    await vi.waitFor(() => expect(s.events).toContainEqual(expect.objectContaining({
      type: 'task_notification',
      taskStatus: 'stopped',
    })))
    expect(s.runtime.hasBackgroundWork(s.sessionId)).toBe(false)
  })

  it('stops every background command of the session at once', async () => {
    const s = await session()
    await s.run('CALL bash {"command":"sleep 30","description":"Wait","run_in_background":true}')

    s.runtime.stopBackgroundWork(s.sessionId)

    await vi.waitFor(() => expect(s.runtime.hasBackgroundWork(s.sessionId)).toBe(false))
  })
})
