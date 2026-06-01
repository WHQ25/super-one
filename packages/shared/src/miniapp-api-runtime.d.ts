export type MiniAppLocale = 'en' | 'zh'

export interface MiniAppTransport {
  send(type: string, data: Record<string, unknown>): void
  request(reqType: string, resType: string, data: Record<string, unknown>, resultKey?: string): Promise<unknown>
  on(type: string, handler: (data: Record<string, unknown>) => void): void
}

export interface PopoverHandle {
  postMessage(data: unknown): void
  onMessage(cb: (data: unknown) => void): void
  close(): void
  onClose(cb: () => void): void
}

export interface PopoverApi {
  data: unknown
  postMessage(data: unknown): void
  onMessage(cb: (data: unknown) => void): void
  close(): void
}

export interface ToolInterceptApi {
  phase: 'intercept'
  callId: string
  toolName: string
  data: unknown
  submit(userInput: Record<string, unknown>): void
  cancel(reason?: string | null): void
}

export interface ToolResultApi {
  phase: 'result'
  callId: string
  toolName: string
  data: unknown
  close(): void
}

export interface ToolStandaloneApi {
  phase: 'standalone'
  callId: string
  toolName: string
  args: Record<string, unknown> | null
  result: unknown
  error: string | null
}

export type ToolRendererApi = ToolInterceptApi | ToolResultApi | ToolStandaloneApi

export interface SuperoneDbApi {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[] | Record<string, unknown>): Promise<T[]>
  exec(sql: string, params?: unknown[] | Record<string, unknown>): Promise<{ changes: number; lastInsertRowid: number }>
  batch(statements: Array<{ sql: string; params?: unknown[] | Record<string, unknown> }>): Promise<Array<{ changes: number; lastInsertRowid: number }>>
  pragma<T = unknown>(name: string, value?: string | number): Promise<T>
}

export interface SuperoneKvApi {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  list(prefix?: string): Promise<string[]>
}

export interface SuperoneApi {
  version: string
  tools: {
    handle(name: string, callback: (args: Record<string, unknown>) => unknown): void
    /** Internal handler registry — exposed so the standalone bridge can dispatch by callId. Not for author code. */
    _handlers: Map<string, (args: Record<string, unknown>) => unknown | Promise<unknown>>
  }
  /**
   * Project-scoped SQLite DB (default). Lives at `<repoRoot>/.superone/apps/<appId>/data/main.db`;
   * worktrees of the same repo share it. Throws if no project is open. Use `db.user` for a
   * machine-wide DB shared across all projects.
   */
  db: SuperoneDbApi & { project: SuperoneDbApi; user: SuperoneDbApi }
  /**
   * Project-scoped key-value store (default), backed by the same per-repo DB as `db`.
   * Throws if no project is open. Use `kv.user` for a machine-wide store.
   */
  kv: SuperoneKvApi & { project: SuperoneKvApi; user: SuperoneKvApi }
  peer: {
    on(event: string, callback: (payload: unknown) => void): () => void
    emit(event: string, payload?: unknown): void
  }
  fs: {
    readFile(path: string, opts?: { binary?: boolean }): Promise<string | ArrayBuffer>
    readDir(path?: string): Promise<Array<{ name: string; isDir: boolean }>>
    writeFile(path: string, content: string | ArrayBuffer | Uint8Array, opts?: { append?: boolean }): Promise<void>
    deleteFile(path: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    stat(path: string): Promise<{ size: number; isDir: boolean; isFile: boolean; mtime: number; ctime: number }>
    mkdir(path: string): Promise<void>
    exists(path: string): Promise<boolean>
    glob(pattern: string): Promise<string[]>
    watch(path: string, callback: (event: { type: 'change' | 'rename'; path: string }) => void): Promise<number>
    unwatch(watchId: number): void
  }
  agent: {
    sendPrompt(text: string): void
    setContext(opts: { summary: string; content: string; mode?: 'inject' | 'suggest'; color?: string }): void
    clearContext(): void
    onContextConsumed(cb: () => void): () => void
  }
  openFolder(path: string): void
  openExternalLink(url: string): void
  clipboard: {
    read(): Promise<string>
    write(text: string): void
  }
  git: {
    info(): Promise<unknown>
    branches(): Promise<unknown>
    log(opts?: { limit?: number; all?: boolean; ref?: string }): Promise<unknown>
    status(): Promise<unknown>
    diff(path: string, staged?: boolean): Promise<unknown>
    show(ref: string, path: string): Promise<unknown>
    blame(path: string): Promise<unknown>
    diffSummary(ref1: string, ref2?: string): Promise<unknown>
    getCommit(ref?: string): Promise<unknown>
    tags(): Promise<unknown>
    remotes(): Promise<unknown>
    branchDetail(name: string): Promise<unknown>
    stashList(): Promise<unknown>
    logFile(path: string, opts?: { limit?: number }): Promise<unknown>
    onHeadChange(cb: () => void): () => void
  }
  locale: {
    get(): MiniAppLocale
    onChange(cb: (locale: MiniAppLocale) => void): () => void
  }
  theme: {
    getVars(): Record<string, string>
    onChange(cb: (vars: Record<string, string>) => void): () => void
  }
  ui: {
    toast(message: string, type?: 'success' | 'error' | 'warning' | 'info'): void
    showTooltip(anchorRect: { x: number; y: number; width: number; height: number }, text: string, side?: 'top' | 'bottom' | 'left' | 'right'): void
    hideTooltip(): void
    startDrag(paths: string | string[], opts?: { iconPng?: ArrayBuffer; scaleFactor?: number }): void
    showContextMenu(position: { x: number; y: number }, items: Array<{ id: string; label: string; icon?: string; disabled?: boolean; variant?: string; separator?: boolean; group?: string }>): Promise<string | null>
    showPopover(options: {
      template: string
      data?: unknown
      anchorRect: { x: number; y: number; width: number; height: number }
      side?: 'top' | 'bottom' | 'left' | 'right'
      align?: 'start' | 'center' | 'end'
      width?: number
      maxHeight?: number
    }): PopoverHandle
  }
  popover?: PopoverApi
  tool?: ToolRendererApi
  isDarkMode(): boolean
  onDarkModeChange(cb: (isDark: boolean) => void): () => void
  worker: {
    start(): Promise<{ running: boolean; since?: number }>
    stop(): Promise<{ running: boolean; since?: number }>
    status(): Promise<{ running: boolean; since?: number }>
    postMessage(msg: unknown): void
    onMessage(handler: (msg: unknown) => void): () => void
  }
}

export interface SuperoneSelfApi {
  onMessage(handler: (msg: unknown) => void): () => void
  postMessage(msg: unknown): void
  setStatus(text: string): void
  keepAlive(label: string): { release: () => void }
}

export function createSuperoneApi(transport: MiniAppTransport, version: string, opts?: { initialLocale?: MiniAppLocale }): SuperoneApi
export function createSuperoneSelf(transport: MiniAppTransport): SuperoneSelfApi
export function startSuperoneResize(transport: MiniAppTransport): void
export function installSuperoneMediaProbe(transport: MiniAppTransport): void
