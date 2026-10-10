import type { PhoneTerminalStream, RelayClient, TerminalPaint } from '@superone/relay-client'
import { TerminalAssembler } from '@superone/relay-client'
import type { TerminalEvent, TerminalListItem, TerminalStatus } from '@superone/shared/agent-types'
import type { MutatingControlContext } from '@superone/shared/environment/lease'
import type { ProjectRef, TerminalRef } from '@superone/shared/environment/refs'
import { randomId } from './ids'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'

export type TerminalTabUi = { terminalId: string; title: string; status: TerminalStatus }
export type TerminalUi = { writable: boolean; title: string; tabs: TerminalTabUi[]; activeId: string }
type Client = Pick<RelayClient, 'rpc' | 'resolveProject' | 'acquireControl' | 'releaseControl' | 'controlledRpc' | 'followTerminal'>
type Held = { resource: TerminalRef; proof: MutatingControlContext }
const DEFAULT_TITLE = 'Terminal'

/** Native terminal RPCs and one selected output stream. Grants never follow a tab implicitly. */
export class TerminalRuntime {
  readonly assembler = new TerminalAssembler()
  terminalId = ''
  writable = false
  status: TerminalStatus = 'running'
  title = DEFAULT_TITLE
  tabs: TerminalTabUi[] = []
  private target: { projectPath: string; sessionId?: string } | null = null
  private project: ProjectRef | null = null
  private generation = 0
  private creating = false
  private disposed = false
  private stream: PhoneTerminalStream | null = null
  private held: Held | null = null
  private pendingCreate: { projectPath: string; sessionId?: string; idempotencyKey: string } | null = null

  constructor(private readonly client: Client, private readonly onPaint: (paints: TerminalPaint[]) => void, private readonly hooks: { onEmpty?: () => void } = {}) {}

  get ui(): TerminalUi { return { writable: this.writable, title: this.title, tabs: this.tabs, activeId: this.terminalId } }

  ingest(raw: unknown): void {
    if (this.disposed || !raw || typeof raw !== 'object') return
    const event = raw as TerminalEvent
    const environmentId = (raw as { environmentId?: string }).environmentId
    if (environmentId && environmentId !== this.project?.environmentId) return
    if (event.type === 'terminal_created') {
      const path = this.target && (parseRemoteProjectKey(this.target.projectPath)?.path ?? this.target.projectPath)
      const item = event.item
      if (path && (item.projectPath === path || item.cwd === path || item.cwd === this.assembler.snapshot?.cwd || item.cwd.startsWith(path.endsWith('/') ? path : `${path}/`))) {
        this.upsertTab({ terminalId: item.terminalId, title: item.title, status: item.status })
        this.emit([])
      }
      return
    }
    if ('terminalId' in event && event.terminalId !== this.terminalId) {
      if (event.type === 'terminal_title_changed') this.renameTab(event.terminalId, event.title)
      else if (event.type === 'terminal_exited') this.dropTab(event.terminalId)
      return
    }
    const paints = this.assembler.apply(raw)
    for (const paint of paints) {
      if (paint.kind === 'replace') {
        this.writable = paint.snapshot.writableByMe && this.held !== null
        this.status = paint.snapshot.status
        this.title = paint.snapshot.title || this.title
        this.upsertTab({ terminalId: this.terminalId, title: this.title, status: this.status })
      } else if (paint.kind === 'meta' && typeof paint.writableByMe === 'boolean') {
        this.writable = paint.writableByMe && this.held !== null
        if (!paint.writableByMe) this.releaseHeld()
      } else if (paint.kind === 'title') {
        this.renameTab(paint.terminalId, paint.title)
        this.title = paint.title
      } else if (paint.kind === 'exited') this.dropTab(this.terminalId)
    }
    this.emit(paints.filter(paint => ['replace', 'append', 'meta', 'error'].includes(paint.kind)).map(paint => paint.kind === 'replace'
      ? { ...paint, snapshot: { ...paint.snapshot, writableByMe: this.writable } }
      : paint.kind === 'meta' ? { ...paint, writableByMe: this.writable } : paint))
  }

  async open(projectPath: string, sessionId?: string): Promise<void> {
    if (this.disposed) return
    const target = this.target = { projectPath, ...(sessionId ? { sessionId } : {}) }
    const generation = ++this.generation
    this.creating = false
    this.detach()
    try {
      const project = await this.client.resolveProject(projectPath)
      if (!this.current(generation)) return
      this.project = project
      const reply = await this.client.rpc<{ terminals: TerminalListItem[] }>('terminal.list', { projectId: project.projectId, ...(sessionId ? { sessionId } : {}) }, { environmentId: project.environmentId })
      if (!this.current(generation)) return
      if (!Array.isArray(reply.terminals)) throw new Error('invalid terminal list')
      this.tabs = reply.terminals.map(item => ({ terminalId: item.terminalId, title: item.title || DEFAULT_TITLE, status: item.status }))
      if (!this.tabs.length) { await this.create(target.projectPath, target.sessionId); return }
      this.pendingCreate = null
      const preferred = this.tabs.find(item => item.terminalId === this.terminalId) ?? this.tabs.find(item => item.status === 'running') ?? this.tabs[0]
      await this.select(preferred.terminalId)
    } catch (error) { if (this.current(generation)) this.error(error) }
  }

  async create(projectPath: string, sessionId?: string): Promise<void> {
    if (this.disposed || this.creating) return
    this.creating = true
    const generation = this.generation
    this.target = { projectPath, ...(sessionId ? { sessionId } : {}) }
    const pending = this.pendingCreate?.projectPath === projectPath && this.pendingCreate.sessionId === sessionId
      ? this.pendingCreate : { projectPath, ...(sessionId ? { sessionId } : {}), idempotencyKey: randomId() }
    this.pendingCreate = pending
    try {
      const project = await this.client.resolveProject(projectPath)
      if (!this.current(generation)) return
      const terminal = await this.client.rpc<{ terminalId: string; title: string }>('terminal.create', { projectId: project.projectId, ...(sessionId ? { sessionId } : {}) }, { environmentId: project.environmentId, idempotencyKey: pending.idempotencyKey })
      if (!this.current(generation)) return
      if (this.pendingCreate === pending) this.pendingCreate = null
      this.project = project
      this.upsertTab({ terminalId: terminal.terminalId, title: terminal.title || DEFAULT_TITLE, status: 'running' })
      await this.select(terminal.terminalId)
    } catch (error) { if (this.current(generation)) this.error(error) }
    finally { if (this.current(generation) || this.pendingCreate === null) this.creating = false }
  }

  async select(terminalId: string): Promise<void> {
    if (this.disposed || !terminalId || !this.project) return
    if (terminalId === this.terminalId && this.stream) { await this.claim(); return }
    const generation = ++this.generation
    this.detach()
    const tab = this.tabs.find(item => item.terminalId === terminalId)
    this.terminalId = terminalId
    this.writable = false
    this.status = tab?.status ?? 'running'
    this.title = tab?.title || DEFAULT_TITLE
    this.assembler.reset()
    this.emit([{ kind: 'replace', ansi: '', snapshot: { terminalId, cwd: '', title: this.title, status: this.status, cols: 80, rows: 24, lastSeq: 0, ownerDeviceId: null, writableByMe: false, subscriberCount: 0 } }])
    await this.attach(generation)
  }

  async closeTab(terminalId: string): Promise<void> {
    if (this.disposed || !terminalId || !this.project) return
    const resource = { environmentId: this.project.environmentId, terminalId }
    const generation = this.generation
    let temporary: MutatingControlContext | undefined
    try {
      if (terminalId === this.terminalId && this.held) await this.client.controlledRpc(resource, 'terminal.kill')
      else {
        const grant = await this.client.acquireControl(resource)
        temporary = { leaseId: grant.leaseId, generation: grant.generation }
        await this.client.rpc('terminal.kill', { terminalId, ...temporary }, { environmentId: resource.environmentId })
      }
      if (this.current(generation)) this.dropTab(terminalId)
    } catch (error) { if (this.current(generation)) this.error(error) }
    finally { if (temporary) await this.client.releaseControl(resource, temporary).catch(() => {}) }
  }

  recover(): void {
    if (this.disposed || this.status === 'exited') return
    if (this.target) void this.open(this.target.projectPath, this.target.sessionId)
  }

  input(data: string): void {
    if (data && data.length <= 64 * 1_024) this.write('terminal.write', { data })
  }
  resize(cols: number, rows: number): void {
    if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows) || cols < 2 || cols > 1_000 || rows < 1 || rows > 500) return
    this.write('terminal.resize', { cols, rows })
  }
  handleViewMessage(raw: unknown): void {
    let value = raw
    if (typeof value === 'string') { try { value = JSON.parse(value) } catch { return } }
    if (!value || typeof value !== 'object') return
    const message = value as { type?: string; data?: unknown; cols?: unknown; rows?: unknown; title?: unknown }
    if (message.type === 'terminalInput' && typeof message.data === 'string') this.input(message.data)
    else if (message.type === 'terminalResize' && typeof message.cols === 'number' && typeof message.rows === 'number') this.resize(message.cols, message.rows)
    else if (message.type === 'terminalTitle' && typeof message.title === 'string') {
      this.renameTab(this.terminalId, message.title)
      this.title = message.title.trim() || this.title
      this.emit([])
    } else if (message.type === 'terminalReady') void this.stream?.refresh().catch(error => this.error(error))
  }
  async claim(): Promise<void> {
    if (this.disposed || !this.project || !this.terminalId) return
    const generation = this.generation
    await this.acquire(generation)
    if (this.current(generation)) await this.stream?.refresh().catch(error => this.error(error))
  }
  controlLost(resource: TerminalRef, error: Error): void {
    if (this.project?.environmentId !== resource.environmentId || this.terminalId !== resource.terminalId) return
    this.writable = false
    this.held = null
    this.error(error)
    this.emit([{ kind: 'meta', writableByMe: false }])
  }
  dispose(): void {
    this.disposed = true
    this.generation++
    this.detach()
  }
  private async attach(generation: number): Promise<void> {
    await this.acquire(generation)
    if (!this.current(generation) || !this.project) return
    const stream = this.client.followTerminal({ environmentId: this.project.environmentId, terminalId: this.terminalId },
      event => { if (this.current(generation)) this.ingest(event) },
      error => { if (this.current(generation)) { this.writable = false; this.releaseHeld(); this.error(error); this.emit([{ kind: 'meta', writableByMe: false }]) } })
    this.stream = stream
    await stream.ready.catch(() => {}) // onEnd reports the same failure once.
  }
  private async acquire(generation: number): Promise<void> {
    if (!this.project || !this.terminalId) return
    const resource = { environmentId: this.project.environmentId, terminalId: this.terminalId }
    try {
      const grant = await this.client.acquireControl(resource)
      const proof = { leaseId: grant.leaseId, generation: grant.generation }
      if (!this.current(generation)) { await this.client.releaseControl(resource, proof).catch(() => {}); return }
      this.held = { resource, proof }
    } catch (error) { if (this.current(generation)) { this.writable = false; this.releaseHeld(); this.error(error) } }
  }
  private write(method: string, payload: Record<string, unknown>): void {
    if (!this.writable || this.status !== 'running' || !this.held) return
    const held = this.held
    void this.client.controlledRpc(held.resource, method, payload).catch(error => {
      if (this.held !== held) return
      const code = (error as { code?: string })?.code
      if (code === 'lease_required' || code === 'lease_stale') this.controlLost(held.resource, error)
      else this.error(error)
    })
  }
  private releaseHeld(): void {
    const held = this.held
    this.held = null
    if (held) void this.client.releaseControl(held.resource, held.proof).catch(() => {})
  }
  private detach(): void {
    const stream = this.stream
    this.stream = null
    const wasWritable = this.writable
    this.writable = false
    void stream?.close().catch(() => {})
    this.releaseHeld()
    if (wasWritable) this.emit([{ kind: 'meta', writableByMe: false }])
  }
  private current(generation: number): boolean { return !this.disposed && this.generation === generation }
  private upsertTab(tab: TerminalTabUi): void {
    const next = { ...tab, title: tab.title.trim() || DEFAULT_TITLE }
    this.tabs = this.tabs.some(item => item.terminalId === tab.terminalId) ? this.tabs.map(item => item.terminalId === tab.terminalId ? next : item) : [...this.tabs, next]
  }
  private renameTab(terminalId: string, title: string): void {
    if (title.trim()) this.tabs = this.tabs.map(item => item.terminalId === terminalId ? { ...item, title: title.trim() } : item)
    this.emit([])
  }
  private dropTab(terminalId: string): void {
    if (!this.tabs.some(item => item.terminalId === terminalId)) return
    this.tabs = this.tabs.filter(item => item.terminalId !== terminalId)
    if (this.terminalId !== terminalId) { this.emit([]); return }
    this.generation++
    this.detach()
    this.terminalId = ''
    this.writable = false
    const next = this.tabs[this.tabs.length - 1]
    if (next) void this.select(next.terminalId)
    else { this.status = 'exited'; this.title = DEFAULT_TITLE; this.emit([]); this.hooks.onEmpty?.() }
  }
  private error(reason: unknown): void {
    this.emit([{ kind: 'error', code: (reason as { code?: string })?.code ?? 'terminal_failed', message: reason instanceof Error ? reason.message : String(reason) }])
  }
  private emit(paints: TerminalPaint[]): void { if (!this.disposed) this.onPaint(paints) }
}
