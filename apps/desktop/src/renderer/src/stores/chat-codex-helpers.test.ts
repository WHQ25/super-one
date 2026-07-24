import type { ChatMessage, CodexAuthStatus, CodexThreadItem, CodexUsageInfo, ContentBlock, ModelOption } from '@superone/shared/agent-types'
import {
  accumulateCodexFooterTokens,
  applyDelta,
  findLatestCodexUsage,
  formatCodexAuthStatus,
  getLatestCodexThreadId,
  parseCodexCommand,
  removeCodexItem,
  resolveCodexModelSelection,
  resolveCodexReasoningEffort,
  upsertCodexItem,
} from './chat'

function makeUsage(overrides: Partial<CodexUsageInfo> = {}): CodexUsageInfo {
  return {
    totalInputTokens: 100,
    totalCachedInputTokens: 20,
    totalCacheWriteInputTokens: 0,
    totalOutputTokens: 50,
    lastInputTokens: 30,
    lastCachedInputTokens: 5,
    lastCacheWriteInputTokens: 0,
    lastOutputTokens: 15,
    reasoningOutputTokens: 0,
    contextWindow: 128000,
    ...overrides,
  }
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    status: 'complete',
    content: [],
    createdAt: new Date().toISOString(),
    providerId: 'codex',
    ...overrides,
  }
}

function makeCodexItem(overrides: Partial<CodexThreadItem> = {}): CodexThreadItem {
  return {
    id: 'item-1',
    type: 'agent_message',
    text: 'hello',
    ...overrides,
  } as CodexThreadItem
}

describe('parseCodexCommand', () => {
  it('should return null for non-slash input', () => {
    expect(parseCodexCommand('hello')).toBeNull()
  })

  it('should return null for empty string', () => {
    expect(parseCodexCommand('')).toBeNull()
  })

  it('should return null for bare slash', () => {
    expect(parseCodexCommand('/')).toBeNull()
  })

  it('should return null for unknown command', () => {
    expect(parseCodexCommand('/unknown')).toBeNull()
  })

  it('should parse /help', () => {
    expect(parseCodexCommand('/help')).toEqual({ kind: 'help' })
  })

  it('should parse /reset', () => {
    expect(parseCodexCommand('/reset')).toEqual({ kind: 'reset' })
  })

  it('should parse /compact', () => {
    expect(parseCodexCommand('/compact')).toEqual({ kind: 'compact' })
  })

  it('should parse /plan', () => {
    expect(parseCodexCommand('/plan')).toEqual({ kind: 'plan' })
  })

  it('should parse /review with no args as uncommittedChanges', () => {
    expect(parseCodexCommand('/review')).toEqual({ kind: 'review', target: { type: 'uncommittedChanges' } })
  })

  it('should parse /review branch <name>', () => {
    expect(parseCodexCommand('/review branch main')).toEqual({
      kind: 'review',
      target: { type: 'baseBranch', branch: 'main' },
    })
  })

  it('should open the branch picker for /review branch without a branch name', () => {
    expect(parseCodexCommand('/review branch')).toEqual({ kind: 'review-picker' })
  })

  it('should parse /review commit <sha>', () => {
    expect(parseCodexCommand('/review commit abc123')).toEqual({ kind: 'review', target: { type: 'commit', sha: 'abc123' } })
  })

  it('should return help for /review commit without sha', () => {
    expect(parseCodexCommand('/review commit')).toEqual({ kind: 'help' })
  })

  it('should parse /auth as auth-status', () => {
    expect(parseCodexCommand('/auth')).toEqual({ kind: 'auth-status' })
  })

  it('should parse /auth auto', () => {
    expect(parseCodexCommand('/auth auto')).toEqual({ kind: 'auth-set', mode: 'auto' })
  })

  it('should parse /auth chatgpt', () => {
    expect(parseCodexCommand('/auth chatgpt')).toEqual({ kind: 'auth-set', mode: 'chatgpt' })
  })

  it('should parse /auth apikey with key', () => {
    expect(parseCodexCommand('/auth apikey sk-test-123')).toEqual({ kind: 'auth-set', mode: 'apiKey', apiKey: 'sk-test-123' })
  })

  it('should parse /auth apikey without key', () => {
    expect(parseCodexCommand('/auth apikey')).toEqual({ kind: 'auth-set', mode: 'apiKey', apiKey: undefined })
  })

  it('should return help for unknown auth subcommand', () => {
    expect(parseCodexCommand('/auth invalid')).toEqual({ kind: 'help' })
  })

  it('should handle whitespace after slash', () => {
    expect(parseCodexCommand('/ help')).toEqual({ kind: 'help' })
  })
})

describe('resolveCodexReasoningEffort', () => {
  it('should return undefined when model has no supported efforts', () => {
    const model: ModelOption = { id: 'm1', name: 'M1', description: '' }
    expect(resolveCodexReasoningEffort(model)).toBeUndefined()
  })

  it('should return undefined when model is undefined', () => {
    expect(resolveCodexReasoningEffort(undefined)).toBeUndefined()
  })

  it('should return preferred effort when supported', () => {
    const model: ModelOption = {
      id: 'm1', name: 'M1', description: '',
      supportedReasoningEfforts: [{ value: 'low', description: '' }, { value: 'high', description: '' }],
    }
    expect(resolveCodexReasoningEffort(model, 'high')).toBe('high')
  })

  it('should fall back to default effort when preferred is not supported', () => {
    const model: ModelOption = {
      id: 'm1', name: 'M1', description: '',
      supportedReasoningEfforts: [{ value: 'low', description: '' }, { value: 'medium', description: '' }],
      defaultReasoningEffort: 'medium',
    }
    expect(resolveCodexReasoningEffort(model, 'high')).toBe('medium')
  })

  it('should fall back to last option when neither preferred nor default is available', () => {
    const model: ModelOption = {
      id: 'm1', name: 'M1', description: '',
      supportedReasoningEfforts: [{ value: 'low', description: '' }, { value: 'medium', description: '' }],
      defaultReasoningEffort: 'xhigh',
    }
    expect(resolveCodexReasoningEffort(model, 'high')).toBe('medium')
  })

  it('should return default effort when no preferred is given', () => {
    const model: ModelOption = {
      id: 'm1', name: 'M1', description: '',
      supportedReasoningEfforts: [{ value: 'low', description: '' }, { value: 'high', description: '' }],
      defaultReasoningEffort: 'high',
    }
    expect(resolveCodexReasoningEffort(model)).toBe('high')
  })
})

describe('resolveCodexModelSelection', () => {
  const models: ModelOption[] = [
    { id: 'gpt-4', name: 'GPT-4', description: '', supportedReasoningEfforts: [{ value: 'medium', description: '' }] },
    { id: 'o3', name: 'O3', description: '', isDefault: true, supportedReasoningEfforts: [{ value: 'high', description: '' }], defaultReasoningEffort: 'high' },
  ]

  it('should select the specified model when it exists', () => {
    const result = resolveCodexModelSelection(models, 'gpt-4')
    expect(result.modelId).toBe('gpt-4')
  })

  it('should fall back to default model when selected is empty', () => {
    const result = resolveCodexModelSelection(models, '')
    expect(result.modelId).toBe('o3')
    expect(result.reasoningEffort).toBe('high')
  })

  it('should fall back to default model when selected is not found', () => {
    const result = resolveCodexModelSelection(models, 'nonexistent')
    expect(result.modelId).toBe('o3')
  })

  it('should fall back to first model when no default exists', () => {
    const modelsNoDefault: ModelOption[] = [
      { id: 'a', name: 'A', description: '' },
      { id: 'b', name: 'B', description: '' },
    ]
    const result = resolveCodexModelSelection(modelsNoDefault, 'nonexistent')
    expect(result.modelId).toBe('a')
  })

  it('should return empty modelId when models list is empty', () => {
    const result = resolveCodexModelSelection([], 'anything')
    expect(result.modelId).toBe('')
    expect(result.reasoningEffort).toBeUndefined()
  })

  it('should resolve reasoning effort for selected model', () => {
    const result = resolveCodexModelSelection(models, 'gpt-4', 'medium')
    expect(result.reasoningEffort).toBe('medium')
  })
})

describe('formatCodexAuthStatus', () => {
  it('should format all fields correctly', () => {
    const status: CodexAuthStatus = {
      mode: 'auto',
      resolvedMode: 'apiKey',
      hasEnvApiKey: true,
      hasSessionApiKey: false,
      isRunning: false,
    }
    const result = formatCodexAuthStatus(status)
    expect(result).toContain('configured mode: auto')
    expect(result).toContain('resolved mode: apiKey')
    expect(result).toContain('env CODEX_API_KEY: set')
    expect(result).toContain('session API key: not set')
    expect(result).toContain('runtime state: idle')
  })

  it('should show running state and session key', () => {
    const status: CodexAuthStatus = {
      mode: 'chatgpt',
      resolvedMode: 'chatgpt',
      hasEnvApiKey: false,
      hasSessionApiKey: true,
      isRunning: true,
    }
    const result = formatCodexAuthStatus(status)
    expect(result).toContain('session API key: set')
    expect(result).toContain('runtime state: running')
  })
})

describe('getLatestCodexThreadId', () => {
  it('should return undefined for empty messages', () => {
    expect(getLatestCodexThreadId([])).toBeUndefined()
  })

  it('should return undefined when no codex assistant messages', () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: 'user', providerId: 'codex' }),
      makeMessage({ role: 'assistant', providerId: 'claude' }),
    ]
    expect(getLatestCodexThreadId(messages)).toBeUndefined()
  })

  it('should return thread id from latest codex assistant message', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'm1', metadata: { codex: { threadId: 'thread-1', usage: null, items: [] } } }),
      makeMessage({ id: 'm2', metadata: { codex: { threadId: 'thread-2', usage: null, items: [] } } }),
    ]
    expect(getLatestCodexThreadId(messages)).toBe('thread-2')
  })

  it('should skip messages without threadId', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'm1', metadata: { codex: { threadId: 'thread-1', usage: null, items: [] } } }),
      makeMessage({ id: 'm2', metadata: {} }),
    ]
    expect(getLatestCodexThreadId(messages)).toBe('thread-1')
  })
})

describe('applyDelta', () => {
  it('should merge consecutive text blocks', () => {
    const content: ContentBlock[] = [{ type: 'text', text: 'Hello ' }]
    const result = applyDelta(content, { type: 'text', text: 'world' })
    expect(result).toEqual([{ type: 'text', text: 'Hello world' }])
  })

  it('should append text when last block is not text', () => {
    const content: ContentBlock[] = [{ type: 'thinking', thinking: 'hmm' }]
    const result = applyDelta(content, { type: 'text', text: 'done' })
    expect(result).toEqual([
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'done' },
    ])
  })

  it('should merge consecutive thinking blocks', () => {
    const content: ContentBlock[] = [{ type: 'thinking', thinking: 'step 1 ' }]
    const result = applyDelta(content, { type: 'thinking', thinking: 'step 2' })
    expect(result).toEqual([{ type: 'thinking', thinking: 'step 1 step 2' }])
  })

  it('should update existing tool_use by toolUseId', () => {
    const content: ContentBlock[] = [
      { type: 'tool_use', toolUseId: 't1', toolName: 'Read', input: {}, startedAt: 1000 } as ContentBlock,
    ]
    const delta = { type: 'tool_use', toolUseId: 't1', toolName: 'Read', input: { path: '/a' }, status: 'running' } as unknown as ContentBlock
    const result = applyDelta(content, delta)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ toolUseId: 't1', input: { path: '/a' }, startedAt: 1000 })
  })

  it('should append new tool_use with startedAt', () => {
    const before = Date.now()
    const content: ContentBlock[] = []
    const delta = { type: 'tool_use', toolUseId: 't1', toolName: 'Read', input: {} } as ContentBlock
    const result = applyDelta(content, delta)
    expect(result).toHaveLength(1)
    const block = result[0] as Record<string, unknown>
    expect(block.startedAt).toBeGreaterThanOrEqual(before)
  })

  it('should mark tool_use as complete on tool_result', () => {
    const content: ContentBlock[] = [
      { type: 'tool_use', toolUseId: 't1', toolName: 'Read', input: {} } as ContentBlock,
    ]
    const delta: ContentBlock = { type: 'tool_result', toolUseId: 't1', summary: 'done' }
    const result = applyDelta(content, delta)
    expect(result).toHaveLength(2)
    expect((result[0] as Record<string, unknown>).status).toBe('complete')
    expect(result[1].type).toBe('tool_result')
  })

  it('should append unknown block types', () => {
    const content: ContentBlock[] = []
    const delta = { type: 'image', name: 'test.png' } as ContentBlock
    const result = applyDelta(content, delta)
    expect(result).toEqual([{ type: 'image', name: 'test.png' }])
  })

  it('should preserve existing status on tool_use update when delta has no status', () => {
    const content: ContentBlock[] = [
      { type: 'tool_use', toolUseId: 't1', toolName: 'Read', input: {}, status: 'running', startedAt: 1000 } as unknown as ContentBlock,
    ]
    const delta = { type: 'tool_use', toolUseId: 't1', toolName: 'Read', input: { path: '/b' } } as unknown as ContentBlock
    const result = applyDelta(content, delta)
    expect((result[0] as Record<string, unknown>).status).toBe('running')
  })

  it('should apply to empty content array', () => {
    const result = applyDelta([], { type: 'text', text: 'start' })
    expect(result).toEqual([{ type: 'text', text: 'start' }])
  })
})

describe('upsertCodexItem', () => {
  it('should append a new item', () => {
    const items: CodexThreadItem[] = []
    const next = makeCodexItem({ id: 'a' })
    const result = upsertCodexItem(items, next)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a')
  })

  it('should update an existing item by id', () => {
    const items: CodexThreadItem[] = [makeCodexItem({ id: 'a', text: 'old' } as Partial<CodexThreadItem>)]
    const next = makeCodexItem({ id: 'a', text: 'new' } as Partial<CodexThreadItem>)
    const result = upsertCodexItem(items, next)
    expect(result).toHaveLength(1)
    expect((result[0] as { text: string }).text).toBe('new')
  })

  it('should not mutate the original array', () => {
    const items: CodexThreadItem[] = [makeCodexItem({ id: 'a' })]
    const next = makeCodexItem({ id: 'b' })
    const result = upsertCodexItem(items, next)
    expect(result).toHaveLength(2)
    expect(items).toHaveLength(1)
  })
})

describe('removeCodexItem', () => {
  it('should remove an item by id', () => {
    const items: CodexThreadItem[] = [makeCodexItem({ id: 'a' }), makeCodexItem({ id: 'b' })]
    const result = removeCodexItem(items, 'a')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b')
  })

  it('should return same-length array when id not found', () => {
    const items: CodexThreadItem[] = [makeCodexItem({ id: 'a' })]
    const result = removeCodexItem(items, 'nonexistent')
    expect(result).toHaveLength(1)
  })

  it('should return empty array when removing from single-item list', () => {
    const items: CodexThreadItem[] = [makeCodexItem({ id: 'a' })]
    expect(removeCodexItem(items, 'a')).toEqual([])
  })
})

describe('accumulateCodexFooterTokens', () => {
  it('should accumulate step tokens from usage', () => {
    const current = { input: 0, output: 0 }
    const usage = makeUsage({ lastInputTokens: 100, lastCachedInputTokens: 20, lastOutputTokens: 50 })
    const result = accumulateCodexFooterTokens(current, usage, null)
    expect(result.input).toBe(80)
    expect(result.output).toBe(50)
  })

  it('should skip when usage is same as previous', () => {
    const current = { input: 10, output: 5 }
    const usage = makeUsage()
    const result = accumulateCodexFooterTokens(current, usage, usage)
    expect(result).toBe(current)
  })

  it('should skip when usage has invalid values', () => {
    const current = { input: 10, output: 5 }
    const usage = makeUsage({ totalInputTokens: NaN })
    const result = accumulateCodexFooterTokens(current, usage, null)
    expect(result).toBe(current)
  })

  it('should add to existing totals', () => {
    const current = { input: 100, output: 50 }
    const usage = makeUsage({ lastInputTokens: 40, lastCachedInputTokens: 10, lastOutputTokens: 20 })
    const result = accumulateCodexFooterTokens(current, usage, null)
    expect(result.input).toBe(130)
    expect(result.output).toBe(70)
  })
})

describe('findLatestCodexUsage', () => {
  it('should return null for empty messages', () => {
    expect(findLatestCodexUsage([])).toBeNull()
  })

  it('should return null when no messages have usage', () => {
    const messages: ChatMessage[] = [makeMessage(), makeMessage({ id: 'm2' })]
    expect(findLatestCodexUsage(messages)).toBeNull()
  })

  it('should return usage from the latest message that has it', () => {
    const usage1 = makeUsage({ totalInputTokens: 100 })
    const usage2 = makeUsage({ totalInputTokens: 200 })
    const messages: ChatMessage[] = [
      makeMessage({ id: 'm1', metadata: { codex: { threadId: null, usage: usage1, items: [] } } }),
      makeMessage({ id: 'm2', metadata: { codex: { threadId: null, usage: usage2, items: [] } } }),
    ]
    expect(findLatestCodexUsage(messages)).toBe(usage2)
  })

  it('should skip messages with invalid usage', () => {
    const validUsage = makeUsage()
    const messages: ChatMessage[] = [
      makeMessage({ id: 'm1', metadata: { codex: { threadId: null, usage: validUsage, items: [] } } }),
      makeMessage({ id: 'm2', metadata: { codex: { threadId: null, usage: makeUsage({ totalInputTokens: NaN }), items: [] } } }),
    ]
    expect(findLatestCodexUsage(messages)).toBe(validUsage)
  })
})
