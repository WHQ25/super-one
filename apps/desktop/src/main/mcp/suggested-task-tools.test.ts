import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAIN_THREAD_ONLY_SUPERONE_TOOL_NAMES,
  isStaticHostOwnedSuperoneBareName,
} from '@superone/shared/superone-host-owned-tools'
import { isNodeLocalSuperoneTool } from '@superone/shared/environment/host-action-browser-catalog'
import { suggestedTaskIdFromResult } from '@superone/shared/suggested-task'

const dismissSuggestedTask = vi.hoisted(() => vi.fn())
vi.mock('../session/suggested-task', async () => {
  class SuggestedTaskError extends Error {}
  return { dismissSuggestedTask, SuggestedTaskError }
})

import { SuggestedTaskError } from '../session/suggested-task'
import { BUILT_IN_SUPERONE_TOOL_DEFS } from './superone-mcp-builtin-defs'
import { sessionDismissTaskHandler, sessionSuggestTaskHandler } from './suggested-task-tools'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

const session = { id: 's1' }

function deps(): BuiltInSuperoneToolDeps {
  return {
    sessionId: 's1',
    sessionHost: { getSession: (id: string) => (id === 's1' ? session : null) } as never,
    notifyDevAppReady: () => {},
    applyAppSettings: () => ({}) as never,
  }
}

function text(result: { content: Array<{ text: string }> }): string {
  return result.content[0].text
}

beforeEach(() => vi.clearAllMocks())

describe('session_suggest_task', () => {
  it('returns a pending card id at once, naming the withdraw tool', async () => {
    const result = await sessionSuggestTaskHandler({ title: 'Fix the flaky login test', tldr: 'Times out on CI.', prompt: 'Fix it.' }, deps())
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(text(result))
    expect(payload).toMatchObject({ status: 'pending' })
    expect(suggestedTaskIdFromResult(text(result))).toBe(payload.taskId)
    expect(payload.note).toMatch(/session_dismiss_task/)
  })

  it('rejects a missing field, a long title, and a cwd that is not an existing absolute folder', async () => {
    const base = { title: 'Fix it', tldr: 'Why.', prompt: 'How.' }
    expect((await sessionSuggestTaskHandler({ ...base, prompt: '  ' }, deps())).isError).toBe(true)
    expect((await sessionSuggestTaskHandler({ ...base, title: 'x'.repeat(61) }, deps())).isError).toBe(true)
    expect((await sessionSuggestTaskHandler({ ...base, cwd: 'relative/path' }, deps())).isError).toBe(true)
    expect((await sessionSuggestTaskHandler({ ...base, cwd: '/definitely/not/here' }, deps())).isError).toBe(true)
    const other = mkdtempSync(join(tmpdir(), 'suggest-task-'))
    expect((await sessionSuggestTaskHandler({ ...base, cwd: other }, deps())).isError).toBeUndefined()
  })
})

describe('session_dismiss_task', () => {
  it('withdraws the card as the agent', async () => {
    const result = await sessionDismissTaskHandler({ taskId: 't1', reason: 'Fixed it' }, deps())
    expect(dismissSuggestedTask).toHaveBeenCalledWith(session, 't1', 'agent', 'Fixed it')
    expect(JSON.parse(text(result))).toEqual({ taskId: 't1', status: 'dismissed' })
  })

  it('reports a card the user already acted on as an error the agent can read', async () => {
    dismissSuggestedTask.mockImplementation(() => { throw new SuggestedTaskError('Suggested task t1 was already launched.') })
    const result = await sessionDismissTaskHandler({ taskId: 't1' }, deps())
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/already launched/)
  })
})

describe('suggested-task tool contract', () => {
  it('is admitted by every harness, main-thread only, and not offered on remote nodes', () => {
    for (const name of ['session_suggest_task', 'session_dismiss_task']) {
      expect(isStaticHostOwnedSuperoneBareName(name)).toBe(true)
      expect(MAIN_THREAD_ONLY_SUPERONE_TOOL_NAMES).toContain(name)
      expect(isNodeLocalSuperoneTool(name)).toBe(true)
    }
  })

  it('ships the withdraw tool with the suggest tool and keeps the brief uncapped', () => {
    const suggest = BUILT_IN_SUPERONE_TOOL_DEFS.find((def) => def.name === 'session_suggest_task')!
    const dismiss = BUILT_IN_SUPERONE_TOOL_DEFS.find((def) => def.name === 'session_dismiss_task')!
    expect(suggest.description).toMatch(/session_dismiss_task/)
    expect(suggest.description).toMatch(/session_collab_request/)
    expect(suggest.inputSchema.required).toEqual(['title', 'tldr', 'prompt'])
    const props = suggest.inputSchema.properties as Record<string, { maxLength?: number }>
    expect(props.title.maxLength).toBe(60)
    expect(props.prompt.maxLength).toBeUndefined()
    expect(dismiss.inputSchema.required).toEqual(['taskId'])
  })
})
