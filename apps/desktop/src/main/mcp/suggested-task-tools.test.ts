import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_SUPERONE_TOOL_NAMES,
  MAIN_THREAD_ONLY_SUPERONE_TOOL_NAMES,
  isStaticHostOwnedSuperoneBareName,
} from '@superone/shared/superone-host-owned-tools'
import { isNodeLocalSuperoneTool } from '@superone/shared/environment/host-action-browser-catalog'
import { suggestedTaskIdFromResult } from '@superone/shared/suggested-task'
import { BUILT_IN_SUPERONE_TOOL_DEFS } from './superone-mcp-builtin-defs'
import { sessionSuggestTaskHandler } from './suggested-task-tools'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

function deps(): BuiltInSuperoneToolDeps {
  return {
    sessionId: 's1',
    sessionHost: null,
    notifyDevAppReady: () => {},
    applyAppSettings: () => ({}) as never,
  }
}

function text(result: { content: Array<{ text: string }> }): string {
  return result.content[0].text
}

describe('session_suggest_task', () => {
  it('returns a pending card id at once', async () => {
    const result = await sessionSuggestTaskHandler({ title: 'Fix the flaky login test', tldr: 'Times out on CI.', prompt: 'Fix it.' }, deps())
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(text(result))
    expect(payload).toEqual({ taskId: expect.any(String), status: 'pending' })
    expect(suggestedTaskIdFromResult(text(result))).toBe(payload.taskId)
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


describe('suggested-task tool contract', () => {
  it('is admitted by every harness, main-thread only, and not offered on remote nodes', () => {
    expect(isStaticHostOwnedSuperoneBareName('session_suggest_task')).toBe(true)
    expect(MAIN_THREAD_ONLY_SUPERONE_TOOL_NAMES).toContain('session_suggest_task')
    expect(isNodeLocalSuperoneTool('session_suggest_task')).toBe(true)
  })

  it('leaves the card to the user and keeps the brief uncapped', () => {
    // Only the user dismisses a card: an agent-side withdraw tool would cost every session a tool slot.
    expect(BUILT_IN_SUPERONE_TOOL_NAMES).not.toContain('session_dismiss_task')
    const suggest = BUILT_IN_SUPERONE_TOOL_DEFS.find((def) => def.name === 'session_suggest_task')!
    expect(suggest.description).toMatch(/session_collab_request/)
    expect(suggest.description).not.toMatch(/dismiss_task/)
    expect(suggest.inputSchema.required).toEqual(['title', 'tldr', 'prompt'])
    const props = suggest.inputSchema.properties as Record<string, { maxLength?: number }>
    expect(props.title.maxLength).toBe(60)
    expect(props.prompt.maxLength).toBeUndefined()
  })
})
