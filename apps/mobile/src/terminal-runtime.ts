import type { RelayClient, TerminalPaint } from '@superone/relay-client'
import { TerminalAssembler } from '@superone/relay-client'
import type { TerminalListItem, TerminalStatus } from '@superone/shared/agent-types'
import { randomId } from './ids'

export type TerminalTabUi = {
  terminalId: string
  title: string
  status: TerminalStatus
}

export type TerminalUi = {
  writable: boolean
  title: string
  tabs: TerminalTabUi[]
  activeId: string
}

const DEFAULT_TITLE = 'Terminal'

function itemMatchesProject(item: { cwd: string; projectPath?: string }, projectPath: string): boolean {
  if (item.projectPath === projectPath) return true
  if (item.cwd === projectPath) return true
  const root = projectPath.endsWith('/') ? projectPath : `${projectPath}/`
  return item.cwd.startsWith(root)
}

function visualPaints(paints: TerminalPaint[]): TerminalPaint[] {
  return paints.filter((paint) => (
    paint.kind === 'replace'
    || paint.kind === 'append'
    || paint.kind === 'meta'
    || paint.kind === 'exited'
    || paint.kind === 'error'
  ))
}

export class TerminalRuntime {
  readonly assembler = new TerminalAssembler()
  terminalId = ''
  writable = false
  status: TerminalStatus = 'running'
  title = DEFAULT_TITLE
  tabs: TerminalTabUi[] = []
  private recoveryTarget: { projectPath: string; sessionId?: string } | null = null
  private creating = false

  constructor(
    private readonly client: Pick<RelayClient, 'send' | 'request'>,
    private readonly onPaint: (paints: TerminalPaint[]) => void,
    private readonly hooks: { onEmpty?: () => void } = {},
  ) {}

  get ui(): TerminalUi {
    return {
      writable: this.writable,
      title: this.title,
      tabs: this.tabs,
      activeId: this.terminalId,
    }
  }

  ingest(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return
    const ev = raw as { type?: string; terminalId?: string; title?: string; exitCode?: number | null; signal?: number | null }
    if (this.terminalId && typeof ev.terminalId === 'string' && ev.terminalId !== this.terminalId) {
      if (ev.type === 'terminal_title_changed' && typeof ev.title === 'string') {
        this.renameTab(ev.terminalId, ev.title)
        this.emit([])
        return
      }
      if (ev.type === 'terminal_exited') {
        this.dropTab(ev.terminalId)
        this.emit([])
        return
      }
      // A create reply can race its snapshot ahead of command_result. Keep
      // that snapshot; drop output from every other live tab.
      if (ev.type === 'terminal_output' || ((ev.type === 'terminal_snapshot' || ev.type === 'terminal_snapshot_chunk') && !this.creating)) {
        return
      }
    }
    const paints = this.assembler.apply(raw)
    for (const p of paints) {
      if (p.kind === 'replace') {
        this.terminalId = p.snapshot.terminalId
        this.writable = p.snapshot.writableByMe
        this.status = p.snapshot.status
        this.title = p.snapshot.title || this.title
        this.upsertTab({
          terminalId: p.snapshot.terminalId,
          title: this.title,
          status: p.snapshot.status,
        })
      } else if (p.kind === 'meta') {
        if (typeof p.writableByMe === 'boolean') this.writable = p.writableByMe
      } else if (p.kind === 'result' && p.ok && p.terminalId) {
        this.creating = false
        this.writable = true
        if (this.terminalId && this.terminalId !== p.terminalId) {
          this.client.send({ type: 'terminal_unsubscribe', terminalId: this.terminalId })
        }
        this.terminalId = p.terminalId
        this.upsertTab({ terminalId: p.terminalId, title: this.title, status: 'running' })
      } else if (p.kind === 'created') {
        const projectPath = this.recoveryTarget?.projectPath
        if (!projectPath || !itemMatchesProject(p.item, projectPath)) continue
        this.upsertTab({
          terminalId: p.item.terminalId,
          title: p.item.title || DEFAULT_TITLE,
          status: p.item.status,
        })
      } else if (p.kind === 'title') {
        this.renameTab(p.terminalId, p.title)
        if (p.terminalId === this.terminalId) this.title = p.title
      } else if (p.kind === 'exited') {
        const closed = this.terminalId
        this.status = 'exited'
        this.writable = false
        if (closed) this.dropTab(closed)
      }
    }
    if (paints.length) this.emit(visualPaints(paints).filter((paint) => paint.kind !== 'exited'))
  }

  /** List existing tabs, or create one when the project has none. */
  open(projectPath: string, sessionId?: string): void {
    this.recoveryTarget = { projectPath, ...(sessionId ? { sessionId } : {}) }
    void this.openExisting()
  }

  create(projectPath: string, sessionId?: string): void {
    this.recoveryTarget = { projectPath, ...(sessionId ? { sessionId } : {}) }
    if (this.creating) return
    this.creating = true
    this.client.send({
      type: 'terminal_create',
      requestId: randomId(),
      projectPath,
      ...(sessionId ? { sessionId } : {}),
    })
  }

  select(terminalId: string): void {
    if (!terminalId) return
    if (terminalId === this.terminalId) {
      this.claim()
      return
    }
    if (this.terminalId) this.client.send({ type: 'terminal_unsubscribe', terminalId: this.terminalId })
    const tab = this.tabs.find((item) => item.terminalId === terminalId)
    this.terminalId = terminalId
    this.writable = false
    this.status = tab?.status ?? 'running'
    this.title = tab?.title || DEFAULT_TITLE
    this.attach()
    this.emit([{
      kind: 'replace',
      ansi: '',
      snapshot: {
        terminalId,
        cwd: '',
        title: this.title,
        status: this.status,
        cols: 80,
        rows: 24,
        lastSeq: 0,
        ownerDeviceId: null,
        writableByMe: false,
        subscriberCount: 0,
      },
    }])
  }

  closeTab(terminalId: string): void {
    if (!terminalId) return
    this.client.send({ type: 'terminal_kill', terminalId })
    const remaining = this.tabs.filter((item) => item.terminalId !== terminalId)
    this.tabs = remaining
    if (this.terminalId !== terminalId) {
      this.emit([])
      return
    }
    const next = remaining[remaining.length - 1]
    if (next) {
      this.terminalId = ''
      this.select(next.terminalId)
      return
    }
    this.terminalId = ''
    this.writable = false
    this.status = 'exited'
    this.title = DEFAULT_TITLE
    this.emit([])
    this.hooks.onEmpty?.()
  }

  /** Restore the terminal subscription after transport/session recovery. */
  recover(): void {
    if (this.status === 'exited') return
    this.creating = false
    if (this.recoveryTarget) {
      this.open(this.recoveryTarget.projectPath, this.recoveryTarget.sessionId)
      return
    }
    if (this.terminalId) this.subscribe()
  }

  input(data: string): void {
    if (!this.terminalId || !this.writable || this.status !== 'running' || !data) return
    this.client.send({ type: 'terminal_input', terminalId: this.terminalId, data })
  }

  resize(cols: number, rows: number): void {
    if (!this.terminalId || !this.writable || this.status !== 'running') return
    if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows)) return
    if (cols < 2 || cols > 1_000 || rows < 1 || rows > 500) return
    this.client.send({ type: 'terminal_resize', terminalId: this.terminalId, cols, rows })
  }

  handleViewMessage(raw: unknown): void {
    let value = raw
    if (typeof value === 'string') {
      try { value = JSON.parse(value) } catch { return }
    }
    if (!value || typeof value !== 'object') return
    const message = value as { type?: string; data?: unknown; cols?: unknown; rows?: unknown; title?: unknown }
    if (message.type === 'terminalInput' && typeof message.data === 'string') {
      this.input(message.data)
      return
    }
    if (message.type === 'terminalResize') {
      if (typeof message.cols === 'number' && typeof message.rows === 'number') {
        this.resize(message.cols, message.rows)
      }
      return
    }
    if (message.type === 'terminalTitle' && typeof message.title === 'string') {
      this.renameTab(this.terminalId, message.title)
      if (this.terminalId) this.title = message.title.trim() || this.title
      this.emit([])
      return
    }
    if (message.type === 'terminalReady' && this.terminalId) {
      this.subscribe()
    }
  }

  claim(): void {
    if (!this.terminalId) return
    this.client.send({ type: 'terminal_claim', requestId: randomId(), terminalId: this.terminalId })
  }

  private async openExisting(): Promise<void> {
    const target = this.recoveryTarget
    if (!target) return
    this.creating = false
    try {
      const reply = await this.client.request({
        type: 'terminal_list',
        requestId: randomId(),
        projectPath: target.projectPath,
        ...(target.sessionId ? { sessionId: target.sessionId } : {}),
      }) as { terminals?: TerminalListItem[]; error?: string }
      const terminals = Array.isArray(reply?.terminals) ? reply.terminals : []
      this.tabs = terminals.map((item) => ({
        terminalId: item.terminalId,
        title: item.title || DEFAULT_TITLE,
        status: item.status,
      }))
      if (this.tabs.length === 0) {
        this.create(target.projectPath, target.sessionId)
        this.emit([])
        return
      }
      const preferred = this.tabs.find((item) => item.terminalId === this.terminalId)
        ?? this.tabs.find((item) => item.status === 'running')
        ?? this.tabs[0]
      if (!preferred) return
      if (preferred.terminalId === this.terminalId) this.attach()
      else {
        const current = this.terminalId
        this.terminalId = ''
        if (current) this.client.send({ type: 'terminal_unsubscribe', terminalId: current })
        this.select(preferred.terminalId)
      }
      this.emit([])
    } catch {
      if (this.terminalId) this.subscribe()
      else this.create(target.projectPath, target.sessionId)
    }
  }

  private subscribe(): void {
    if (!this.terminalId) return
    this.client.send({ type: 'terminal_subscribe', requestId: randomId(), terminalId: this.terminalId })
  }

  /** Subscribe for output and take the writer, the way opening a session does. */
  private attach(): void {
    this.subscribe()
    this.claim()
  }

  private upsertTab(tab: TerminalTabUi): void {
    const title = tab.title.trim() || DEFAULT_TITLE
    const next = { ...tab, title }
    const index = this.tabs.findIndex((item) => item.terminalId === tab.terminalId)
    if (index === -1) this.tabs = [...this.tabs, next]
    else this.tabs = this.tabs.map((item, i) => (i === index ? { ...item, ...next } : item))
  }

  private renameTab(terminalId: string, title: string): void {
    const next = title.trim()
    if (!terminalId || !next) return
    const index = this.tabs.findIndex((item) => item.terminalId === terminalId)
    if (index === -1) return
    if (this.tabs[index].title === next) return
    this.tabs = this.tabs.map((item, i) => (i === index ? { ...item, title: next } : item))
  }

  private markTab(terminalId: string, status: TerminalStatus): void {
    this.tabs = this.tabs.map((item) => (item.terminalId === terminalId ? { ...item, status } : item))
  }

  private dropTab(terminalId: string): void {
    const remaining = this.tabs.filter((item) => item.terminalId !== terminalId)
    this.tabs = remaining
    if (this.terminalId !== terminalId) return
    const next = remaining[remaining.length - 1]
    if (next) {
      this.terminalId = ''
      this.select(next.terminalId)
      return
    }
    this.terminalId = ''
    this.writable = false
    this.status = 'exited'
    this.title = DEFAULT_TITLE
    this.hooks.onEmpty?.()
  }

  private emit(paints: TerminalPaint[]): void {
    this.onPaint(paints)
  }
}
