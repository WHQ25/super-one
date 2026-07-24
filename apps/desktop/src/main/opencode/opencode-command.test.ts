import { describe, expect, it, vi } from 'vitest'
import {
  dispatchOpenCodeRequest,
  resolveOpenCodeCommandInvocation,
  resolveOpenCodeShellCommand,
} from './opencode-command'

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

describe('resolveOpenCodeShellCommand', () => {
  it('recognizes non-empty commands that start with an exclamation mark', () => {
    expect(resolveOpenCodeShellCommand('!  git status')).toBe('git status')
    expect(resolveOpenCodeShellCommand(' !git status')).toBeNull()
    expect(resolveOpenCodeShellCommand('!   ')).toBeNull()
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

  it('routes native shell mode directly to the SDK without prompting the model', async () => {
    const runtime = {
      commands,
      prompt: vi.fn(async () => undefined),
      command: vi.fn(async () => undefined),
      shell: vi.fn(async () => undefined),
    }

    await expect(dispatchOpenCodeRequest(runtime as never, {
      content: '!git status',
      model: 'openai/gpt-5',
      agent: 'build',
    })).resolves.toEqual({ kind: 'turn' })

    expect(runtime.shell).toHaveBeenCalledWith('git status', 'openai/gpt-5', 'build')
    expect(runtime.prompt).not.toHaveBeenCalled()
    expect(runtime.command).not.toHaveBeenCalled()
  })

  it('rejects shell attachments instead of silently dropping them', async () => {
    const runtime = { commands, shell: vi.fn(async () => undefined) }

    await expect(dispatchOpenCodeRequest(runtime as never, {
      content: '!cat image.png',
      images: [{ id: 'image-1', mediaType: 'image/png', data: 'base64' }],
    })).rejects.toThrow('do not support attachments')
    expect(runtime.shell).not.toHaveBeenCalled()

    await expect(dispatchOpenCodeRequest(runtime as never, { content: '!   ' }))
      .rejects.toThrow('cannot be empty')
  })
})
