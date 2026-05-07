vi.mock('./remote-highlighter', () => ({
  initHighlighter: vi.fn(),
  highlightCodeSync: vi.fn(() => null),
  highlightCodeByLang: vi.fn(() => null),
  parseAnsiTokens: vi.fn(() => []),
}))

vi.mock('./logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('./agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('./agent/claude-session-runtime', () => ({ readOutputFile: vi.fn(() => ({ resultText: '', toolEntries: [] })) }))
vi.mock('./split-text-blocks', () => ({
  splitTextIntoBlocks: vi.fn((text: string) => ({ segments: [{ type: 'text', text }], remainder: '' })),
}))

import type { ContentBlock, ChatMessage } from '@superone/shared/agent-types'
import {
  computeTodoItems,
  countLines,
  stripProjectPath,
  computeToolMeta,
  truncateBashOutput,
  stripMessagesForRemote,
  stripEventForRemote,
  RemoteControlService,
} from './remote-control-service'
import type { AgentEvent, PermissionRequest } from '@superone/shared/agent-types'

function toolUseBlock(toolName: string, input: Record<string, unknown>, toolUseId = 'tu-1'): ContentBlock & { type: 'tool_use' } {
  return { type: 'tool_use', toolName, toolUseId, input: JSON.stringify(input) }
}

function makeMessage(content: ContentBlock[], overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    status: 'complete',
    content,
    createdAt: '2024-01-01T00:00:00Z',
    providerId: 'claude',
    ...overrides,
  }
}

describe('computeTodoItems', () => {
  it('should parse TodoWrite with multiple todos', () => {
    const input = JSON.stringify({
      todos: [
        { content: 'Task A', status: 'completed' },
        { content: 'Task B', status: 'pending' },
      ],
    })
    const result = computeTodoItems('TodoWrite', input)
    expect(result).toEqual([
      { content: 'Task A', status: 'completed', taskId: '1' },
      { content: 'Task B', status: 'pending', taskId: '2' },
    ])
  })

  it('should parse TodoWrite with subject fallback', () => {
    const input = JSON.stringify({ todos: [{ subject: 'Subj' }] })
    const result = computeTodoItems('TodoWrite', input)
    expect(result).toEqual([{ content: 'Subj', status: 'pending', taskId: '1' }])
  })

  it('should parse TodoWrite with empty todos array', () => {
    const input = JSON.stringify({ todos: [] })
    expect(computeTodoItems('TodoWrite', input)).toEqual([])
  })

  it('should parse TodoWrite when todos is missing', () => {
    const input = JSON.stringify({})
    expect(computeTodoItems('TodoWrite', input)).toEqual([])
  })

  it('should parse TaskCreate', () => {
    const input = JSON.stringify({ subject: 'New task' })
    expect(computeTodoItems('TaskCreate', input)).toEqual([
      { content: 'New task', status: 'pending' },
    ])
  })

  it('should parse TaskUpdate', () => {
    const input = JSON.stringify({ subject: 'Updated', status: 'completed', taskId: '3' })
    expect(computeTodoItems('TaskUpdate', input)).toEqual([
      { content: 'Updated', status: 'completed', taskId: '3' },
    ])
  })

  it('should return undefined for invalid JSON', () => {
    expect(computeTodoItems('TodoWrite', 'not json')).toBeUndefined()
  })

  it('should return undefined for non-object JSON', () => {
    expect(computeTodoItems('TodoWrite', '"string"')).toBeUndefined()
  })

  it('should return undefined for unknown tool name', () => {
    expect(computeTodoItems('UnknownTool', JSON.stringify({ todos: [] }))).toBeUndefined()
  })
})

describe('countLines', () => {
  it('should return 0 for empty string', () => {
    expect(countLines('')).toBe(0)
  })

  it('should return 1 for single line', () => {
    expect(countLines('hello')).toBe(1)
  })

  it('should count multi-line text', () => {
    expect(countLines('a\nb\nc')).toBe(3)
  })

  it('should count trailing newline as extra line', () => {
    expect(countLines('a\nb\n')).toBe(3)
  })
})

describe('stripProjectPath', () => {
  it('should return value unchanged when no projectPath', () => {
    expect(stripProjectPath('/home/user/project/src/file.ts')).toBe('/home/user/project/src/file.ts')
  })

  it('should strip project path prefix', () => {
    expect(stripProjectPath('/home/user/project/src/file.ts', '/home/user/project')).toBe('src/file.ts')
  })

  it('should strip project path with trailing slash', () => {
    expect(stripProjectPath('/home/user/project/src/file.ts', '/home/user/project/')).toBe('src/file.ts')
  })

  it('should strip all occurrences', () => {
    expect(stripProjectPath('/p/a /p/b', '/p')).toBe('a b')
  })

  it('should return value unchanged when path not found', () => {
    expect(stripProjectPath('/other/path/file.ts', '/home/user/project')).toBe('/other/path/file.ts')
  })
})

describe('computeToolMeta', () => {
  describe('Read', () => {
    it('should extract file name as summary', () => {
      const block = toolUseBlock('Read', { file_path: '/proj/src/main.ts' })
      const result = computeToolMeta(block, '/proj')
      expect(result.toolFilePath).toBe('src/main.ts')
      expect(result.toolSummary).toBe('main.ts')
    })

    it('should include line range in summary', () => {
      const block = toolUseBlock('Read', { file_path: '/proj/file.ts', offset: 10, limit: 20 })
      const result = computeToolMeta(block, '/proj')
      expect(result.toolSummary).toBe('file.ts (L10–29)')
    })

    it('should include offset-only in summary', () => {
      const block = toolUseBlock('Read', { file_path: '/proj/file.ts', offset: 50 })
      const result = computeToolMeta(block, '/proj')
      expect(result.toolSummary).toBe('file.ts (L50+)')
    })

    it('should include pages in summary', () => {
      const block = toolUseBlock('Read', { file_path: '/proj/doc.pdf', pages: '1-5' })
      const result = computeToolMeta(block, '/proj')
      expect(result.toolSummary).toBe('doc.pdf (Page 1-5)')
    })

    it('should default start line to 1 when no offset', () => {
      const block = toolUseBlock('Read', { file_path: '/proj/file.ts', limit: 10 })
      const result = computeToolMeta(block, '/proj')
      expect(result.toolSummary).toBe('file.ts (L1–10)')
    })
  })

  describe('Edit', () => {
    it('should compute line delta', () => {
      const block = toolUseBlock('Edit', {
        file_path: '/proj/file.ts',
        old_string: 'line1\nline2',
        new_string: 'line1\nline2\nline3',
      })
      const result = computeToolMeta(block, '/proj')
      expect(result.toolFilePath).toBe('file.ts')
      expect(result.toolLineDelta).toEqual({ added: 2, removed: 1 })
      expect(result.toolDiff).toBeDefined()
    })

    it('should handle empty old_string (insert)', () => {
      const block = toolUseBlock('Edit', {
        file_path: '/proj/file.ts',
        old_string: '',
        new_string: 'new line',
      })
      const result = computeToolMeta(block, '/proj')
      expect(result.toolLineDelta).toEqual({ added: 1, removed: 0 })
    })

    it('should report only changed lines when replacing single line in middle', () => {
      const block = toolUseBlock('Edit', {
        file_path: '/proj/file.ts',
        old_string: 'a\nb\nc',
        new_string: 'a\nB\nc',
      })
      const result = computeToolMeta(block, '/proj')
      expect(result.toolLineDelta).toEqual({ added: 1, removed: 1 })
    })
  })

  describe('Write', () => {
    it('should compute line delta for new file', () => {
      const block = toolUseBlock('Write', {
        file_path: '/proj/new.ts',
        content: 'line1\nline2\nline3',
      })
      const result = computeToolMeta(block, '/proj')
      expect(result.toolFilePath).toBe('new.ts')
      expect(result.toolLineDelta).toEqual({ added: 3, removed: 0 })
      expect(result.toolDiff).toBe('+line1\n+line2\n+line3')
    })
  })

  describe('Bash', () => {
    it('should use description as summary', () => {
      const block = toolUseBlock('Bash', { description: 'Run tests', command: 'bun test' })
      const result = computeToolMeta(block)
      expect(result.toolSummary).toBe('Run tests')
    })

    it('should fallback to command when no description', () => {
      const block = toolUseBlock('Bash', { command: 'ls -la' })
      const result = computeToolMeta(block)
      expect(result.toolSummary).toBe('ls -la')
    })
  })

  describe('Grep', () => {
    it('should combine pattern and path', () => {
      const block = toolUseBlock('Grep', { pattern: 'TODO', path: '/proj/src' })
      const result = computeToolMeta(block)
      expect(result.toolSummary).toBe('TODO in src')
    })

    it('should use pattern only when no path', () => {
      const block = toolUseBlock('Grep', { pattern: 'TODO' })
      const result = computeToolMeta(block)
      expect(result.toolSummary).toBe('TODO')
    })
  })

  describe('Glob', () => {
    it('should use pattern as summary', () => {
      const block = toolUseBlock('Glob', { pattern: '**/*.ts' })
      const result = computeToolMeta(block)
      expect(result.toolSummary).toBe('**/*.ts')
    })
  })

  describe('TodoWrite', () => {
    it('should include done count in summary', () => {
      const block = toolUseBlock('TodoWrite', {
        todos: [
          { content: 'A', status: 'completed' },
          { content: 'B', status: 'pending' },
          { content: 'C', status: 'completed' },
        ],
      })
      const result = computeToolMeta(block)
      expect(result.toolSummary).toBe('Todos (2/3)')
      expect(result.toolTodos).toHaveLength(3)
    })
  })

  it('should return empty object for invalid JSON input', () => {
    const block = { type: 'tool_use' as const, toolName: 'Read', toolUseId: 'tu-1', input: 'not json' }
    expect(computeToolMeta(block)).toEqual({})
  })
})

describe('truncateBashOutput', () => {
  it('should return short text unchanged', () => {
    expect(truncateBashOutput('hello')).toBe('hello')
  })

  it('should truncate by line count', () => {
    const lines = Array.from({ length: 150 }, (_, i) => `line ${i}`)
    const result = truncateBashOutput(lines.join('\n'))
    const resultLines = result.split('\n')
    expect(resultLines).toHaveLength(101)
    expect(resultLines[100]).toBe('…')
  })

  it('should truncate by character count', () => {
    const longLine = 'x'.repeat(6000)
    const result = truncateBashOutput(longLine)
    expect(result.length).toBe(5001)
    expect(result.endsWith('…')).toBe(true)
  })

  it('should apply line limit before character limit', () => {
    const lines = Array.from({ length: 200 }, () => 'x'.repeat(100))
    const result = truncateBashOutput(lines.join('\n'))
    expect(result.split('\n').length).toBeLessThanOrEqual(101)
    expect(result.length).toBeLessThanOrEqual(5001)
  })
})

describe('RemoteControlService connected devices', () => {
  it('keeps device online while any transport is still connected', () => {
    const registered: unknown[] = []
    const disconnected: unknown[] = []
    const service = new RemoteControlService('wss://relay.example', {
      onCommand: vi.fn(),
      onClientRegistered: (info) => registered.push(info),
      onClientDisconnected: (info) => disconnected.push(info),
    })
    const internals = service as unknown as {
      markDeviceOnline: (name: string, id: string, via: 'lan' | 'relay') => void
      markDeviceOffline: (id: string, via: 'lan' | 'relay') => void
    }

    internals.markDeviceOnline('Phone', 'dev-1', 'relay')
    expect(service.getOnlineDevices().get('dev-1')).toEqual({ name: 'Phone', transport: 'relay' })

    internals.markDeviceOnline('Phone', 'dev-1', 'lan')
    expect(service.getOnlineDevices().get('dev-1')).toEqual({ name: 'Phone', transport: 'lan' })

    internals.markDeviceOffline('dev-1', 'lan')
    expect(service.getOnlineDevices().get('dev-1')).toEqual({ name: 'Phone', transport: 'relay' })
    expect(disconnected).toEqual([])

    internals.markDeviceOffline('dev-1', 'relay')
    expect(service.getOnlineDevices().has('dev-1')).toBe(false)
    expect(disconnected).toEqual([{ deviceId: 'dev-1' }])
    expect(registered).toEqual([
      { deviceName: 'Phone', deviceId: 'dev-1', transport: 'relay', firstConnect: true },
      { deviceName: 'Phone', deviceId: 'dev-1', transport: 'lan', firstConnect: false },
      { deviceName: 'Phone', deviceId: 'dev-1', transport: 'relay', firstConnect: false },
    ])
  })
})

describe('RemoteControlService content_delta ordering', () => {
  function makeService(): { service: RemoteControlService; captured: AgentEvent[] } {
    const captured: AgentEvent[] = []
    const service = new RemoteControlService('wss://relay.example', { onCommand: vi.fn() })
    const internals = service as unknown as {
      keys: unknown
      hasAnyMobileTransport: () => boolean
      queueSend: (events: AgentEvent[], targets?: string[]) => void
    }
    internals.keys = { aesKey: {} }
    internals.hasAnyMobileTransport = () => true
    internals.queueSend = (events) => { captured.push(...events) }
    return { service, captured }
  }

  function deltaSig(e: AgentEvent): string {
    if (e.type !== 'content_delta') return e.type
    const d = (e as Extract<AgentEvent, { type: 'content_delta' }>).delta
    return `content_delta:${d.type}`
  }

  it('preserves thinking-before-text ordering when a short thinking is followed by text that flushes early on \\n\\n', async () => {
    const { service, captured } = makeService()

    await service.sendAgentEvent({ type: 'content_delta', messageId: 'm1', delta: { type: 'thinking', thinking: 'short reasoning', parentToolUseId: null } } as AgentEvent)
    await service.sendAgentEvent({ type: 'content_delta', messageId: 'm1', delta: { type: 'text', text: 'visible answer\n\n', parentToolUseId: null } } as AgentEvent)
    await service.sendAgentEvent({ type: 'content_delta', messageId: 'm1', delta: { type: 'text', text: 'tail', parentToolUseId: null } } as AgentEvent)
    await service.sendAgentEvent({ type: 'message_complete', messageId: 'm1', metadata: {} } as AgentEvent)

    const order = captured.map(deltaSig)
    const thinkingIdx = order.indexOf('content_delta:thinking')
    const firstTextIdx = order.indexOf('content_delta:text')
    expect(thinkingIdx).toBeGreaterThanOrEqual(0)
    expect(firstTextIdx).toBeGreaterThanOrEqual(0)
    expect(thinkingIdx).toBeLessThan(firstTextIdx)
  })

  it('flushes pending thinking before starting to accumulate text on the same message so output reflects emit-time order', async () => {
    const { service, captured } = makeService()

    await service.sendAgentEvent({ type: 'content_delta', messageId: 'm1', delta: { type: 'thinking', thinking: 'reasoning A', parentToolUseId: null } } as AgentEvent)
    await service.sendAgentEvent({ type: 'content_delta', messageId: 'm1', delta: { type: 'text', text: 'answer A', parentToolUseId: null } } as AgentEvent)
    await service.sendAgentEvent({ type: 'message_complete', messageId: 'm1', metadata: {} } as AgentEvent)

    const order = captured.map(deltaSig).filter((t) => t.startsWith('content_delta:'))
    const lastThinking = order.lastIndexOf('content_delta:thinking')
    const firstText = order.indexOf('content_delta:text')
    expect(lastThinking).toBeGreaterThanOrEqual(0)
    expect(firstText).toBeGreaterThanOrEqual(0)
    expect(lastThinking).toBeLessThan(firstText)
  })

  it('flushes pending text before starting to accumulate thinking when text precedes thinking on the same message', async () => {
    const { service, captured } = makeService()

    await service.sendAgentEvent({ type: 'content_delta', messageId: 'm1', delta: { type: 'text', text: 'preamble', parentToolUseId: null } } as AgentEvent)
    await service.sendAgentEvent({ type: 'content_delta', messageId: 'm1', delta: { type: 'thinking', thinking: 'mid-stream reasoning', parentToolUseId: null } } as AgentEvent)
    await service.sendAgentEvent({ type: 'message_complete', messageId: 'm1', metadata: {} } as AgentEvent)

    const order = captured.map(deltaSig).filter((t) => t.startsWith('content_delta:'))
    const lastText = order.lastIndexOf('content_delta:text')
    const firstThinking = order.indexOf('content_delta:thinking')
    expect(lastText).toBeGreaterThanOrEqual(0)
    expect(firstThinking).toBeGreaterThanOrEqual(0)
    expect(lastText).toBeLessThan(firstThinking)
  })
})

describe('stripEventForRemote permission_request', () => {
  function makePermissionEvent(toolName: string, input: Record<string, unknown>): AgentEvent {
    const request: PermissionRequest = { requestId: 'req-1', toolName, input, allowAlwaysAllow: false }
    return { type: 'permission_request', request }
  }

  it('should attach toolLineDelta when enriching Edit permission request', () => {
    const event = makePermissionEvent('Edit', {
      file_path: '/proj/file.ts',
      old_string: 'a\nb\nc',
      new_string: 'a\nB\nc',
    })
    const result = stripEventForRemote(event, '/proj') as AgentEvent & { type: 'permission_request' }
    expect(result.request.toolLineDelta).toEqual({ added: 1, removed: 1 })
    expect(result.request.toolDiff).toBeDefined()
  })

  it('should attach toolLineDelta when enriching Write permission request', () => {
    const event = makePermissionEvent('Write', {
      file_path: '/proj/new.ts',
      content: 'a\nb\nc',
    })
    const result = stripEventForRemote(event, '/proj') as AgentEvent & { type: 'permission_request' }
    expect(result.request.toolLineDelta).toEqual({ added: 3, removed: 0 })
  })
})

describe('stripMessagesForRemote', () => {
  it('should pass through text blocks', () => {
    const msg = makeMessage([{ type: 'text', text: 'Hello world' }])
    const [result] = stripMessagesForRemote([msg])
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'Hello world' })
  })

  it('should pass through thinking blocks', () => {
    const msg = makeMessage([{ type: 'thinking', thinking: 'Let me think...' }])
    const [result] = stripMessagesForRemote([msg])
    expect(result.content[0]).toMatchObject({ type: 'thinking', thinking: 'Let me think...' })
  })

  it('should strip tool_use input and set mapped type', () => {
    const msg = makeMessage([
      toolUseBlock('Read', { file_path: '/proj/src/file.ts' }),
    ])
    const [result] = stripMessagesForRemote([msg], '/proj')
    expect(result.content[0]).toMatchObject({ type: 'read', input: '', toolFilePath: 'src/file.ts' })
  })

  it('should convert Bash tool_result to bash_result with command prefix', () => {
    const msg = makeMessage([
      toolUseBlock('Bash', { command: 'ls' }, 'bash-1'),
      { type: 'tool_result', toolUseId: 'bash-1', summary: 'file1\nfile2' } as ContentBlock,
    ])
    const [result] = stripMessagesForRemote([msg])
    const bashResult = result.content.find((b) => (b as { toolUseId?: string }).toolUseId === 'bash-1' && b.type === 'bash_result')
    expect(bashResult).toBeDefined()
    expect((bashResult as { summary: string }).summary).toContain('ls')
    expect((bashResult as { summary: string }).summary).toContain('file1')
  })

  it('should truncate long tool_result summary', () => {
    const msg = makeMessage([
      toolUseBlock('Read', { file_path: '/proj/file.ts' }, 'read-1'),
      { type: 'tool_result', toolUseId: 'read-1', summary: 'x'.repeat(500) } as ContentBlock,
    ])
    const [result] = stripMessagesForRemote([msg])
    const toolResult = result.content.find((b) => (b as { toolUseId?: string }).toolUseId === 'read-1' && b.type === 'tool_result')
    expect(toolResult).toBeDefined()
    expect((toolResult as { summary: string }).summary.length).toBeLessThanOrEqual(201)
  })

  it('should convert TodoWrite to todo_result and remove tool_use block', () => {
    const msg = makeMessage([
      toolUseBlock('TodoWrite', { todos: [{ content: 'A', status: 'pending' }] }, 'todo-1'),
      { type: 'tool_result', toolUseId: 'todo-1', summary: 'ok' } as ContentBlock,
    ])
    const [result] = stripMessagesForRemote([msg])
    const todoUse = result.content.find((b) => b.type === 'tool_use')
    expect(todoUse).toBeUndefined()
    const todoResult = result.content.find((b) => b.type === 'todo_result')
    expect(todoResult).toBeDefined()
    expect((todoResult as { toolTodos: unknown[] }).toolTodos).toHaveLength(1)
  })

  it('should strip codex metadata', () => {
    const msg = makeMessage([{ type: 'text', text: 'done' }], {
      metadata: { codex: { items: [] } as unknown as ChatMessage['metadata'] & { codex: unknown } } as ChatMessage['metadata'],
    })
    const [result] = stripMessagesForRemote([msg])
    expect(result.metadata).toBeDefined()
    expect((result.metadata as Record<string, unknown>).codex).toBeUndefined()
  })

  it('should handle empty messages array', () => {
    expect(stripMessagesForRemote([])).toEqual([])
  })
})

describe('RemoteControlService LAN frame seq', () => {
  let service: RemoteControlService | null = null
  let client: import('ws').WebSocket | null = null

  afterEach(async () => {
    client?.close()
    client?.removeAllListeners()
    client = null
    await service?.stop()
    service = null
  })

  it('injects monotonically increasing seq into LAN frames so mobile seq filter does not drop them', async () => {
    const { WebSocket } = await import('ws')
    const { webcrypto } = await import('node:crypto')
    const { bytesToHex } = await import('./remote-control-crypto')

    const masterSecret = bytesToHex(webcrypto.getRandomValues(new Uint8Array(32)).buffer)
    const deviceId = 'mobile-test'

    service = new RemoteControlService('ws://127.0.0.1:1', {
      onCommand: vi.fn(),
      isPairedDevice: () => true,
    })
    await service.start({
      enabled: true,
      masterSecret,
      deviceId: 'desktop-test',
      preventSleep: false,
      relayUrl: 'ws://127.0.0.1:1',
    })

    const port = service.getLanPort()
    expect(port).not.toBeNull()

    client = new WebSocket(`ws://127.0.0.1:${port}/ws?role=mobile`)
    await new Promise<void>((r) => client!.once('open', () => r()))
    client.send(JSON.stringify({ type: 'register', deviceName: 'tester', mobileDeviceId: deviceId }))

    const frames: Array<Record<string, unknown>> = []
    client.on('message', (raw) => {
      try {
        const f = JSON.parse(raw.toString())
        if (f.type === 'event') frames.push(f)
      } catch { /* ignore */ }
    })
    await new Promise<void>((r) => {
      const onMsg = (raw: import('ws').RawData) => {
        try {
          const f = JSON.parse(raw.toString())
          if (f.type === 'handshake') { client!.off('message', onMsg); r() }
        } catch { /* ignore */ }
      }
      client!.on('message', onMsg)
    })

    for (let i = 0; i < 3; i++) {
      await service.sendEventToMobile({ type: 'status_change', status: 'streaming', n: i }, [deviceId])
    }
    await new Promise((r) => setTimeout(r, 100))

    expect(frames).toHaveLength(3)
    expect(frames[0].seq).toBe(1)
    expect(frames[1].seq).toBe(2)
    expect(frames[2].seq).toBe(3)
  })

  it('resets LAN frame seq on stop so a fresh start begins at 1', async () => {
    const { WebSocket } = await import('ws')
    const { webcrypto } = await import('node:crypto')
    const { bytesToHex } = await import('./remote-control-crypto')

    const masterSecret = bytesToHex(webcrypto.getRandomValues(new Uint8Array(32)).buffer)
    const deviceId = 'mobile-test'

    service = new RemoteControlService('ws://127.0.0.1:1', {
      onCommand: vi.fn(),
      isPairedDevice: () => true,
    })
    const config = {
      enabled: true,
      masterSecret,
      deviceId: 'desktop-test',
      preventSleep: false,
      relayUrl: 'ws://127.0.0.1:1',
    }
    await service.start(config)

    const captureFrames = async (): Promise<Array<Record<string, unknown>>> => {
      const port = service!.getLanPort()
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?role=mobile`)
      await new Promise<void>((r) => ws.once('open', () => r()))
      ws.send(JSON.stringify({ type: 'register', deviceName: 'tester', mobileDeviceId: deviceId }))
      const collected: Array<Record<string, unknown>> = []
      ws.on('message', (raw) => {
        try {
          const f = JSON.parse(raw.toString())
          if (f.type === 'event') collected.push(f)
        } catch { /* ignore */ }
      })
      await new Promise<void>((r) => {
        const onMsg = (raw: import('ws').RawData) => {
          try {
            const f = JSON.parse(raw.toString())
            if (f.type === 'handshake') { ws.off('message', onMsg); r() }
          } catch { /* ignore */ }
        }
        ws.on('message', onMsg)
      })
      await service!.sendEventToMobile({ type: 'status_change', status: 'streaming' }, [deviceId])
      await service!.sendEventToMobile({ type: 'status_change', status: 'idle' }, [deviceId])
      await new Promise((r) => setTimeout(r, 80))
      ws.close()
      ws.removeAllListeners()
      return collected
    }

    const first = await captureFrames()
    expect(first.map((f) => f.seq)).toEqual([1, 2])

    await service.stop()
    await service.start(config)

    const second = await captureFrames()
    expect(second.map((f) => f.seq)).toEqual([1, 2])
  })
})
