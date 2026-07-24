import { describe, expect, it, vi } from 'vitest'
import { dispatchOpenCodeRequest, resolveOpenCodeCommandInvocation } from './opencode-command'

const commands = [
  { name: 'review', description: '', argumentHint: '', isSkill: false },
  { name: 'review deep', description: '', argumentHint: '', isSkill: false },
]

describe('resolveOpenCodeCommandInvocation', () => {
  it('matches the longest known command and preserves multiline arguments', () => {
    expect(resolveOpenCodeCommandInvocation('/review deep src\nwith context', commands)).toEqual({
      name: 'review deep',
      arguments: 'src\nwith context',
    })
  })

  it('does not treat unknown or partial names as SDK commands', () => {
    expect(resolveOpenCodeCommandInvocation('/unknown value', commands)).toBeNull()
    expect(resolveOpenCodeCommandInvocation('/reviewer value', commands)).toBeNull()
  })
})

describe('dispatchOpenCodeRequest', () => {
  it('forwards the selected agent to prompts and SDK commands', async () => {
    const runtime = {
      commands,
      prompt: vi.fn(async () => undefined),
      command: vi.fn(async () => undefined),
    }
    await dispatchOpenCodeRequest(runtime as never, { content: 'hello', agent: 'build' })
    await dispatchOpenCodeRequest(runtime as never, { content: '/review tree', agent: 'general' })
    expect(runtime.prompt).toHaveBeenCalledWith('hello', undefined, undefined, undefined, 'build')
    expect(runtime.command).toHaveBeenCalledWith('review', 'tree', undefined, undefined, undefined, 'general')
  })

  it('returns local slash output for session sharing without prompting the model', async () => {
    const runtime = {
      commands,
      prompt: vi.fn(async () => undefined),
      command: vi.fn(async () => undefined),
      share: vi.fn(async () => 'https://opncd.ai/share/demo'),
      unshare: vi.fn(async () => undefined),
    }

    await expect(dispatchOpenCodeRequest(runtime as never, { content: '/share' })).resolves.toEqual({
      kind: 'local',
      command: 'share',
      content: '[Open shared session](https://opncd.ai/share/demo)\n\nThis link is public.',
    })
    await expect(dispatchOpenCodeRequest(runtime as never, { content: '/unshare' })).resolves.toEqual({
      kind: 'local', command: 'unshare', content: 'Public access removed.',
    })
    expect(runtime.prompt).not.toHaveBeenCalled()
    expect(runtime.command).not.toHaveBeenCalled()
  })
})
