import { describe, expect, it, vi } from 'vitest'
import { TerminalRuntime } from './terminal-runtime'

const snapshot = {
  terminalId: 'term-1',
  cwd: '/project',
  title: 'shell',
  status: 'running' as const,
  cols: 80,
  rows: 24,
  lastSeq: 1,
  ownerDeviceId: 'mobile',
  writableByMe: true,
  subscriberCount: 1,
}

function setup(request: ReturnType<typeof vi.fn> = vi.fn()) {
  const send = vi.fn()
  const paints: unknown[] = []
  const onEmpty = vi.fn()
  const runtime = new TerminalRuntime({ send, request } as never, (next) => paints.push(...next), { onEmpty })
  runtime.ingest({ type: 'terminal_snapshot', terminalId: 'term-1', snapshot, ansi: '$ ' })
  return { runtime, send, request, paints, onEmpty }
}

describe('TerminalRuntime WebView bridge', () => {
  it('forwards xterm input and bounded resize commands', () => {
    const { runtime, send } = setup()
    runtime.handleViewMessage(JSON.stringify({ type: 'terminalInput', data: 'ls\r' }))
    runtime.handleViewMessage(JSON.stringify({ type: 'terminalResize', cols: 120, rows: 42 }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'terminal_input', terminalId: 'term-1', data: 'ls\r' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'terminal_resize', terminalId: 'term-1', cols: 120, rows: 42 })
  })

  it('ignores malformed, out-of-range, and read-only input', () => {
    const { runtime, send } = setup()
    runtime.handleViewMessage('{')
    runtime.handleViewMessage({ type: 'terminalResize', cols: 0, rows: 24 })
    runtime.handleViewMessage({ type: 'terminalResize', cols: 80.5, rows: 24 })
    runtime.handleViewMessage({ type: 'terminalResize', cols: '80', rows: 24 })
    runtime.ingest({ type: 'terminal_owner_changed', terminalId: 'term-1', ownerDeviceId: 'desktop', writableByMe: false })
    runtime.handleViewMessage({ type: 'terminalInput', data: 'blocked' })
    expect(send).not.toHaveBeenCalled()
  })

  it('resubscribes after the WebView is ready so an early snapshot is replayed', () => {
    const { runtime, send } = setup()
    runtime.handleViewMessage({ type: 'terminalReady' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'terminal_subscribe',
      terminalId: 'term-1',
      requestId: expect.any(String),
    }))
  })

  it('resubscribes a live terminal after reconnect and skips an exited terminal', () => {
    const { runtime, send } = setup()
    runtime.recover()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'terminal_subscribe',
      terminalId: 'term-1',
    }))

    send.mockClear()
    runtime.ingest({ type: 'terminal_exited', terminalId: 'term-1', exitCode: 0 })
    runtime.recover()
    expect(send).not.toHaveBeenCalled()
  })

  it('recreates a terminal whose create request was interrupted by reconnect', async () => {
    const send = vi.fn()
    const request = vi.fn().mockResolvedValue({ terminals: [] })
    const runtime = new TerminalRuntime({ send, request } as never, vi.fn())
    runtime.create('/project', 'session-1')
    send.mockClear()

    runtime.recover()
    await Promise.resolve()
    await Promise.resolve()
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      type: 'terminal_list',
      projectPath: '/project',
      sessionId: 'session-1',
    }))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'terminal_create',
      projectPath: '/project',
      sessionId: 'session-1',
    }))
  })
})

describe('TerminalRuntime tabs', () => {
  it('opens existing project terminals instead of creating another', async () => {
    const send = vi.fn()
    const request = vi.fn().mockResolvedValue({
      terminals: [
        { terminalId: 'a', cwd: '/project', title: 'npm run dev', status: 'running', ownerDeviceId: null },
        { terminalId: 'b', cwd: '/project', title: 'vim', status: 'running', ownerDeviceId: null },
      ],
    })
    const runtime = new TerminalRuntime({ send, request } as never, vi.fn())
    runtime.open('/project', 'session-1')
    await Promise.resolve()
    await Promise.resolve()

    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'terminal_create' }))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'terminal_subscribe',
      terminalId: 'a',
    }))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'terminal_claim',
      terminalId: 'a',
    }))
    expect(runtime.ui.tabs.map((tab) => tab.title)).toEqual(['npm run dev', 'vim'])
    expect(runtime.ui.title).toBe('npm run dev')
    expect(runtime.ui.activeId).toBe('a')
  })

  it('creates a terminal when the project has none', async () => {
    const send = vi.fn()
    const request = vi.fn().mockResolvedValue({ terminals: [] })
    const runtime = new TerminalRuntime({ send, request } as never, vi.fn())
    runtime.open('/project')
    await Promise.resolve()
    await Promise.resolve()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'terminal_create',
      projectPath: '/project',
    }))
  })

  it('unsubscribes the previous tab when switching', async () => {
    const send = vi.fn()
    const request = vi.fn().mockResolvedValue({
      terminals: [
        { terminalId: 'term-1', cwd: '/p', title: 'shell', status: 'running', ownerDeviceId: null },
        { terminalId: 'term-2', cwd: '/p', title: 'vim', status: 'running', ownerDeviceId: null },
      ],
    })
    const runtime = new TerminalRuntime({ send, request } as never, vi.fn())
    runtime.open('/p')
    await Promise.resolve()
    await Promise.resolve()
    send.mockClear()
    runtime.select('term-2')
    expect(send).toHaveBeenCalledWith({ type: 'terminal_unsubscribe', terminalId: 'term-1' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'terminal_subscribe',
      terminalId: 'term-2',
    }))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'terminal_claim',
      terminalId: 'term-2',
    }))
    expect(runtime.ui.activeId).toBe('term-2')
    expect(runtime.ui.title).toBe('vim')
  })

  it('kills a tab and promotes the previous one, or reports empty', async () => {
    const send = vi.fn()
    const request = vi.fn().mockResolvedValue({
      terminals: [
        { terminalId: 'term-1', cwd: '/p', title: 'shell', status: 'running', ownerDeviceId: null },
        { terminalId: 'term-2', cwd: '/p', title: 'vim', status: 'running', ownerDeviceId: null },
      ],
    })
    const onEmpty = vi.fn()
    const runtime = new TerminalRuntime({ send, request } as never, vi.fn(), { onEmpty })
    runtime.open('/p')
    await Promise.resolve()
    await Promise.resolve()
    send.mockClear()
    runtime.closeTab('term-2')
    expect(send).toHaveBeenCalledWith({ type: 'terminal_kill', terminalId: 'term-2' })
    expect(runtime.ui.activeId).toBe('term-1')
    expect(onEmpty).not.toHaveBeenCalled()

    runtime.closeTab('term-1')
    expect(runtime.ui.tabs).toEqual([])
    expect(onEmpty).toHaveBeenCalled()
  })

  it('drops a tab when another client closes it', async () => {
    const send = vi.fn()
    const request = vi.fn().mockResolvedValue({
      terminals: [
        { terminalId: 'term-1', cwd: '/p', title: 'shell', status: 'running', ownerDeviceId: null },
        { terminalId: 'term-2', cwd: '/p', title: 'vim', status: 'running', ownerDeviceId: null },
      ],
    })
    const runtime = new TerminalRuntime({ send, request } as never, vi.fn())
    runtime.open('/p')
    await Promise.resolve()
    await Promise.resolve()
    runtime.ingest({ type: 'terminal_exited', terminalId: 'term-2', exitCode: 0, signal: null })
    expect(runtime.ui.tabs.map((tab) => tab.terminalId)).toEqual(['term-1'])
  })

  it('updates the active title from OSC events and ignores output from other tabs', () => {
    const { runtime, paints } = setup()
    paints.length = 0
    runtime.ingest({ type: 'terminal_title_changed', terminalId: 'term-1', title: 'npm run dev' })
    expect(runtime.ui.title).toBe('npm run dev')
    expect(runtime.ui.tabs[0].title).toBe('npm run dev')

    runtime.ingest({
      type: 'terminal_output',
      terminalId: 'other',
      data: 'secret',
      fromSeq: 2,
      toSeq: 2,
      createdAt: 0,
    })
    expect(paints.some((paint) => paint && typeof paint === 'object' && 'data' in paint && paint.data === 'secret')).toBe(false)
  })

  it('promotes a WebView title change onto the active tab', () => {
    const { runtime } = setup()
    runtime.handleViewMessage({ type: 'terminalTitle', title: 'git status' })
    expect(runtime.ui.title).toBe('git status')
    expect(runtime.ui.tabs[0].title).toBe('git status')
  })
})
