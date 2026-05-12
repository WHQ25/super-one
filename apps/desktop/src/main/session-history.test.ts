import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readdirSyncMock, readFileSyncMock, statSyncMock } = vi.hoisted(() => ({
  readdirSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
}))

const homedirMock = vi.hoisted(() => vi.fn(() => '/home/testuser'))

vi.mock('fs', () => ({
  readdirSync: readdirSyncMock,
  readFileSync: readFileSyncMock,
  statSync: statSyncMock,
}))

vi.mock('os', () => ({
  homedir: homedirMock,
}))

import { listSessions, loadSessionMessages, clearSessionMessageCache } from './session-history'

function jsonl(...lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n')
}

function userEntry(text: string, opts: Record<string, unknown> = {}) {
  return {
    type: 'user',
    uuid: opts.uuid ?? 'u1',
    timestamp: opts.timestamp ?? '2025-01-01T00:00:00Z',
    message: { content: opts.content ?? text },
    ...opts,
  }
}

function assistantEntry(content: unknown[], opts: Record<string, unknown> = {}) {
  return {
    type: 'assistant',
    uuid: opts.uuid ?? 'a1',
    timestamp: opts.timestamp ?? '2025-01-01T00:01:00Z',
    message: { id: opts.msgId ?? 'msg-1', content },
    ...opts,
  }
}

describe('extractUserText (via listSessions)', () => {
  beforeEach(() => {
    readdirSyncMock.mockReset()
    readFileSyncMock.mockReset()
    statSyncMock.mockReset()
  })

  function setupSingleSession(content: string) {
    readdirSyncMock.mockReturnValue(['s1.jsonl'])
    statSyncMock.mockReturnValue({ mtime: new Date('2025-01-01') })
    readFileSyncMock.mockReturnValue(content)
  }

  it('extracts from string content', () => {
    setupSingleSession(jsonl(userEntry('hello world')))
    const sessions = listSessions('/project')
    expect(sessions[0].title).toBe('hello world')
  })

  it('extracts from array content with type:text block', () => {
    setupSingleSession(
      jsonl(
        userEntry('', {
          content: [{ type: 'text', text: 'array text' }],
        })
      )
    )
    const sessions = listSessions('/project')
    expect(sessions[0].title).toBe('array text')
  })

  it('strips local-command-caveat tags', () => {
    setupSingleSession(
      jsonl(userEntry('before <local-command-caveat>hidden</local-command-caveat> after'))
    )
    const sessions = listSessions('/project')
    expect(sessions[0].title).toBe('before  after')
  })

  it('strips local-command-stdout tags', () => {
    setupSingleSession(
      jsonl(userEntry('run <local-command-stdout>output</local-command-stdout> done'))
    )
    const sessions = listSessions('/project')
    expect(sessions[0].title).toBe('run  done')
  })

  it('strips task-notification tags', () => {
    setupSingleSession(
      jsonl(userEntry('hi <task-notification>notify</task-notification> bye'))
    )
    const sessions = listSessions('/project')
    expect(sessions[0].title).toBe('hi  bye')
  })

  it('returns empty when text starts with command-name', () => {
    setupSingleSession(
      jsonl(
        userEntry('<command-name>init</command-name> stuff'),
        userEntry('real title')
      )
    )
    const sessions = listSessions('/project')
    expect(sessions[0].title).toBe('real title')
  })

  it('returns empty when text starts with task-notification', () => {
    setupSingleSession(
      jsonl(
        userEntry('<task-notification>notify</task-notification>'),
        userEntry('actual title')
      )
    )
    const sessions = listSessions('/project')
    expect(sessions[0].title).toBe('actual title')
  })
})

describe('listSessions', () => {
  beforeEach(() => {
    readdirSyncMock.mockReset()
    readFileSyncMock.mockReset()
    statSyncMock.mockReset()
  })

  it('returns empty when directory does not exist', () => {
    readdirSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    expect(listSessions('/nonexistent')).toEqual([])
  })

  it('parses JSONL files and counts user + assistant messages', () => {
    readdirSyncMock.mockReturnValue(['sess.jsonl'])
    statSyncMock.mockReturnValue({ mtime: new Date('2025-06-01') })
    readFileSyncMock.mockReturnValue(
      jsonl(
        userEntry('hi'),
        assistantEntry([{ type: 'text', text: 'hello' }]),
        userEntry('bye')
      )
    )
    const sessions = listSessions('/proj')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].messageCount).toBe(3)
    expect(sessions[0].sessionId).toBe('sess')
  })

  it('truncates long titles at 100 chars', () => {
    const longText = 'a'.repeat(150)
    readdirSyncMock.mockReturnValue(['s.jsonl'])
    statSyncMock.mockReturnValue({ mtime: new Date('2025-01-01') })
    readFileSyncMock.mockReturnValue(jsonl(userEntry(longText)))
    const sessions = listSessions('/proj')
    expect(sessions[0].title).toBe('a'.repeat(100) + '\u2026')
  })

  it('extracts gitBranch from first user message with it', () => {
    readdirSyncMock.mockReturnValue(['s.jsonl'])
    statSyncMock.mockReturnValue({ mtime: new Date('2025-01-01') })
    readFileSyncMock.mockReturnValue(
      jsonl(
        userEntry('first', { gitBranch: undefined }),
        userEntry('second', { gitBranch: 'feat/branch' })
      )
    )
    const sessions = listSessions('/proj')
    expect(sessions[0].gitBranch).toBe('feat/branch')
  })

  it('skips sessions with no messages', () => {
    readdirSyncMock.mockReturnValue(['empty.jsonl'])
    statSyncMock.mockReturnValue({ mtime: new Date('2025-01-01') })
    readFileSyncMock.mockReturnValue('')
    expect(listSessions('/proj')).toEqual([])
  })

  it('skips sessions with no title', () => {
    readdirSyncMock.mockReturnValue(['notitle.jsonl'])
    statSyncMock.mockReturnValue({ mtime: new Date('2025-01-01') })
    readFileSyncMock.mockReturnValue(
      jsonl({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })
    )
    expect(listSessions('/proj')).toEqual([])
  })

  it('sorts by lastActiveAt descending', () => {
    readdirSyncMock.mockReturnValue(['old.jsonl', 'new.jsonl'])
    statSyncMock
      .mockReturnValueOnce({ mtime: new Date('2025-01-01') })
      .mockReturnValueOnce({ mtime: new Date('2025-06-01') })
    readFileSyncMock
      .mockReturnValueOnce(jsonl(userEntry('old session')))
      .mockReturnValueOnce(jsonl(userEntry('new session')))
    const sessions = listSessions('/proj')
    expect(sessions[0].title).toBe('new session')
    expect(sessions[1].title).toBe('old session')
  })
})

describe('convertAssistantContent (via loadSessionMessages)', () => {
  beforeEach(() => {
    clearSessionMessageCache()
    readFileSyncMock.mockReset()
  })

  it('converts text blocks', () => {
    readFileSyncMock.mockReturnValue(
      jsonl(
        userEntry('hi'),
        assistantEntry([{ type: 'text', text: 'response' }])
      )
    )
    const { messages } = loadSessionMessages('/proj', 'test', 50)
    const asst = messages.find((m) => m.role === 'assistant')!
    expect(asst.content).toEqual([{ type: 'text', text: 'response' }])
  })

  it('converts tool_use blocks', () => {
    readFileSyncMock.mockReturnValue(
      jsonl(
        userEntry('hi'),
        assistantEntry([{ type: 'tool_use', id: 'tu1', name: 'Read', input: { path: '/f' } }])
      )
    )
    const { messages } = loadSessionMessages('/proj', 'tooluse', 50)
    const asst = messages.find((m) => m.role === 'assistant')!
    expect(asst.content).toEqual([
      {
        type: 'tool_use',
        toolUseId: 'tu1',
        toolName: 'Read',
        input: '{"path":"/f"}',
        status: 'complete',
      },
    ])
  })

  it('skips unknown block types', () => {
    readFileSyncMock.mockReturnValue(
      jsonl(
        userEntry('hi'),
        assistantEntry([
          { type: 'text', text: 'ok' },
          { type: 'image', url: 'foo' },
        ])
      )
    )
    const { messages } = loadSessionMessages('/proj', 'unknown', 50)
    const asst = messages.find((m) => m.role === 'assistant')!
    expect(asst.content).toEqual([{ type: 'text', text: 'ok' }])
  })
})

describe('convertToolResultContent (via loadSessionMessages)', () => {
  beforeEach(() => {
    clearSessionMessageCache()
    readFileSyncMock.mockReset()
  })

  it('converts tool_result with summary truncation at 200 chars', () => {
    const longContent = 'x'.repeat(300)
    readFileSyncMock.mockReturnValue(
      jsonl(
        userEntry('hi'),
        assistantEntry([{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }], { msgId: 'msg-1' }),
        {
          type: 'user',
          uuid: 'u2',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'tu1', content: longContent }],
          },
        }
      )
    )
    const { messages } = loadSessionMessages('/proj', 'trunc', 50)
    const asst = messages.find((m) => m.role === 'assistant')!
    const toolResult = asst.content.find((b) => b.type === 'tool_result')!
    expect(toolResult.type).toBe('tool_result')
    if (toolResult.type === 'tool_result') {
      expect(toolResult.summary!.length).toBe(201)
      expect(toolResult.summary!.endsWith('\u2026')).toBe(true)
    }
  })

  it('handles string content in tool_result', () => {
    readFileSyncMock.mockReturnValue(
      jsonl(
        userEntry('hi'),
        assistantEntry([{ type: 'tool_use', id: 'tu1', name: 'Bash', input: 'ls' }], { msgId: 'msg-1' }),
        {
          type: 'user',
          uuid: 'u2',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'short' }],
          },
        }
      )
    )
    const { messages } = loadSessionMessages('/proj', 'strres', 50)
    const asst = messages.find((m) => m.role === 'assistant')!
    const toolResult = asst.content.find((b) => b.type === 'tool_result')!
    if (toolResult.type === 'tool_result') {
      expect(toolResult.summary).toBe('short')
    }
  })

  it('handles object content in tool_result', () => {
    readFileSyncMock.mockReturnValue(
      jsonl(
        userEntry('hi'),
        assistantEntry([{ type: 'tool_use', id: 'tu1', name: 'Bash', input: {} }], { msgId: 'msg-1' }),
        {
          type: 'user',
          uuid: 'u2',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'tu1', content: { key: 'val' } }],
          },
        }
      )
    )
    const { messages } = loadSessionMessages('/proj', 'objres', 50)
    const asst = messages.find((m) => m.role === 'assistant')!
    const toolResult = asst.content.find((b) => b.type === 'tool_result')!
    if (toolResult.type === 'tool_result') {
      expect(toolResult.summary).toBe('{"key":"val"}')
    }
  })
})

describe('parseSessionMessages (via loadSessionMessages)', () => {
  beforeEach(() => {
    clearSessionMessageCache()
    readFileSyncMock.mockReset()
  })

  it('merges assistant messages with same provider ID', () => {
    readFileSyncMock.mockReturnValue(
      jsonl(
        userEntry('hi'),
        assistantEntry([{ type: 'text', text: 'part1' }], { uuid: 'a1', msgId: 'same-id' }),
        assistantEntry([{ type: 'text', text: 'part2' }], { uuid: 'a2', msgId: 'same-id' })
      )
    )
    const { messages } = loadSessionMessages('/proj', 'merge', 50)
    const assistants = messages.filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(1)
    expect(assistants[0].content).toEqual([
      { type: 'text', text: 'part1' },
      { type: 'text', text: 'part2' },
    ])
  })

  it('merges tool_result into current assistant message', () => {
    readFileSyncMock.mockReturnValue(
      jsonl(
        userEntry('hi'),
        assistantEntry([{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }], { msgId: 'msg-1' }),
        {
          type: 'user',
          uuid: 'u2',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'result' }],
          },
        }
      )
    )
    const { messages } = loadSessionMessages('/proj', 'toolmerge', 50)
    expect(messages).toHaveLength(2)
    const asst = messages.find((m) => m.role === 'assistant')!
    expect(asst.content.some((b) => b.type === 'tool_result')).toBe(true)
  })

  it('skips sidechain entries', () => {
    readFileSyncMock.mockReturnValue(
      jsonl(
        userEntry('hi'),
        assistantEntry([{ type: 'text', text: 'main' }], { msgId: 'msg-1' }),
        { ...assistantEntry([{ type: 'text', text: 'side' }], { msgId: 'msg-2' }), isSidechain: true }
      )
    )
    const { messages } = loadSessionMessages('/proj', 'sidechain', 50)
    const assistants = messages.filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(1)
    expect(assistants[0].content).toEqual([{ type: 'text', text: 'main' }])
  })

  it('skips entries without message', () => {
    readFileSyncMock.mockReturnValue(
      jsonl(
        userEntry('hi'),
        { type: 'assistant', uuid: 'a1' },
        assistantEntry([{ type: 'text', text: 'ok' }])
      )
    )
    const { messages } = loadSessionMessages('/proj', 'nomsg', 50)
    const assistants = messages.filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(1)
  })
})

describe('loadSessionMessages', () => {
  beforeEach(() => {
    clearSessionMessageCache()
    readFileSyncMock.mockReset()
  })

  function setupMessages(count: number) {
    const lines: object[] = []
    for (let i = 0; i < count; i++) {
      if (i % 2 === 0) {
        lines.push(userEntry(`msg ${i}`, { uuid: `u${i}` }))
      } else {
        lines.push(
          assistantEntry([{ type: 'text', text: `reply ${i}` }], { uuid: `a${i}`, msgId: `mid-${i}` })
        )
      }
    }
    readFileSyncMock.mockReturnValue(jsonl(...lines))
  }

  it('returns last N messages when no cursor', () => {
    setupMessages(10)
    const result = loadSessionMessages('/proj', 'pag1', 3)
    expect(result.messages).toHaveLength(3)
    expect(result.hasMore).toBe(true)
  })

  it('returns N messages before cursor', () => {
    setupMessages(10)
    const first = loadSessionMessages('/proj', 'pag2', 3)
    expect(first.cursor).not.toBeNull()
    const second = loadSessionMessages('/proj', 'pag2', 3, first.cursor!)
    expect(second.messages).toHaveLength(3)
  })

  it('returns hasMore=true when more messages exist', () => {
    setupMessages(10)
    const result = loadSessionMessages('/proj', 'pag3', 3)
    expect(result.hasMore).toBe(true)
    expect(result.cursor).not.toBeNull()
  })

  it('returns hasMore=false when all messages loaded', () => {
    setupMessages(4)
    const result = loadSessionMessages('/proj', 'pag4', 10)
    expect(result.hasMore).toBe(false)
    expect(result.cursor).toBeNull()
  })

  it('uses cache on second call', () => {
    setupMessages(6)
    loadSessionMessages('/proj', 'cache1', 3)
    readFileSyncMock.mockClear()
    loadSessionMessages('/proj', 'cache1', 3)
    expect(readFileSyncMock).not.toHaveBeenCalled()
  })
})
