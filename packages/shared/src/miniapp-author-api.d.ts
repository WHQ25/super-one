export interface SuperOneFsEntry {
  name: string
  isDir: boolean
}

export interface SuperOneFsStat {
  size: number
  isDir: boolean
  isFile: boolean
  mtime: number
  ctime: number
}

export interface SuperOneFsWatchEvent {
  type: 'change' | 'rename'
  path: string
}

export interface SuperOneGitInfo {
  branch: string
  dirty?: { files: number; insertions: number; deletions: number }
}

export interface SuperOneGitLogEntry {
  sha: string
  parents: string[]
  message: string
  author: string
  date: string
}

export interface SuperOneGitStatusEntry {
  path: string
  status: string
  staged: boolean
}

export interface SuperOneGitDiff {
  path: string
  diff: string
}

export interface SuperOneGitShow {
  ref: string
  path: string
  content: string
}

export interface SuperOneGitBlameLine {
  sha: string
  author: string
  date: string
  lineNo: number
  content: string
}

export interface SuperOneGitDiffFile {
  path: string
  insertions: number
  deletions: number
}

export interface SuperOneGitCommit {
  sha: string
  parents: string[]
  subject: string
  body: string
  author: string
  email: string
  date: string
  files: SuperOneGitDiffFile[]
}

export interface SuperOneGitTag {
  name: string
  sha: string
  date: string
}

export interface SuperOneGitRemote {
  name: string
  fetchUrl: string
  pushUrl: string
}

export interface SuperOneGitBranchDetail {
  name: string
  upstream: string | null
  ahead: number
  behind: number
}

export interface SuperOneGitStashEntry {
  ref: string
  message: string
  date: string
}

export interface SuperOneThemeVars {
  [key: string]: string
}

export type SuperOneLocale = 'en' | 'zh'

export interface SuperOneContextMenuItem {
  id: string
  label: string
  icon?: string
  disabled?: boolean
  variant?: 'default' | 'destructive'
  separator?: boolean
  group?: string
}

export interface SuperOnePopoverHandle {
  postMessage(data: unknown): void
  onMessage(callback: (data: unknown) => void): void
  close(): void
  onClose(callback: () => void): void
}

export interface SuperOnePopoverApi {
  readonly data: unknown
  postMessage(data: unknown): void
  onMessage(callback: (data: unknown) => void): void
  close(): void
}

export interface SuperOneToolInterceptApi {
  readonly phase: 'intercept'
  readonly callId: string
  readonly toolName: string
  readonly data: unknown
  submit(userInput: Record<string, unknown>): void
  cancel(reason?: string | null): void
}

export interface SuperOneToolResultApi {
  readonly phase: 'result'
  readonly callId: string
  readonly toolName: string
  readonly data: unknown
  close(): void
}

export interface SuperOneToolStandaloneApi {
  readonly phase: 'standalone'
  readonly callId: string
  readonly toolName: string
  readonly args: Record<string, unknown> | null
  readonly result: unknown
  readonly error: string | null
}

export type SuperOneToolRendererApi = SuperOneToolInterceptApi | SuperOneToolResultApi | SuperOneToolStandaloneApi

export interface SuperOneWorkerStatus {
  running: boolean
  since?: number
  statusText?: string
}

export interface SuperOneSelfApi {
  onMessage(handler: (msg: unknown) => void): () => void
  postMessage(msg: unknown): void
  setStatus(text: string): void
  keepAlive(label: string): { release(): void }
}

export interface SuperOneDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[] | Record<string, unknown>): Promise<T[]>
  exec(sql: string, params?: unknown[] | Record<string, unknown>): Promise<{ changes: number; lastInsertRowid: number }>
  batch(statements: Array<{ sql: string; params?: unknown[] | Record<string, unknown> }>): Promise<Array<{ changes: number; lastInsertRowid: number }>>
  pragma<T = unknown>(name: string, value?: string | number): Promise<T>
}

export interface SuperOneKv {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  list(prefix?: string): Promise<string[]>
}

export interface SuperOne {
  readonly version: string
  tools: {
    handle(name: string, callback: (args: Record<string, unknown>) => unknown | Promise<unknown>): void
  }
  /**
   * Project-scoped SQLite DB (default), stored under the repo root and shared across
   * all worktrees of that repo. Throws if no project is open.
   * Use superone.db.user for a machine-wide DB shared across all projects.
   */
  db: SuperOneDb & { project: SuperOneDb; user: SuperOneDb }
  /**
   * Project-scoped key-value store (default), shared across worktrees of the repo.
   * Throws if no project is open. Use superone.kv.user for a machine-wide store.
   */
  kv: SuperOneKv & { project: SuperOneKv; user: SuperOneKv }
  peer: {
    on(event: string, callback: (payload: unknown) => void): () => void
    emit(event: string, payload?: unknown): void
  }
  fs: {
    readFile(path: string): Promise<string>
    readFile(path: string, opts: { binary: true }): Promise<ArrayBuffer>
    readDir(path?: string): Promise<SuperOneFsEntry[]>
    writeFile(path: string, content: string | ArrayBuffer | Uint8Array, opts?: { append?: boolean }): Promise<void>
    deleteFile(path: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    stat(path: string): Promise<SuperOneFsStat>
    mkdir(path: string): Promise<void>
    exists(path: string): Promise<boolean>
    glob(pattern: string): Promise<string[]>
    watch(path: string, callback: (event: SuperOneFsWatchEvent) => void): Promise<number>
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
    info(): Promise<SuperOneGitInfo>
    branches(): Promise<string[]>
    log(opts?: { limit?: number; all?: boolean; ref?: string }): Promise<SuperOneGitLogEntry[]>
    status(): Promise<SuperOneGitStatusEntry[]>
    diff(path: string, staged?: boolean): Promise<SuperOneGitDiff>
    show(ref: string, path: string): Promise<SuperOneGitShow>
    blame(path: string): Promise<SuperOneGitBlameLine[]>
    diffSummary(ref1: string, ref2?: string): Promise<SuperOneGitDiffFile[]>
    getCommit(ref?: string): Promise<SuperOneGitCommit>
    tags(): Promise<SuperOneGitTag[]>
    remotes(): Promise<SuperOneGitRemote[]>
    branchDetail(name: string): Promise<SuperOneGitBranchDetail>
    stashList(): Promise<SuperOneGitStashEntry[]>
    logFile(path: string, opts?: { limit?: number }): Promise<SuperOneGitLogEntry[]>
    onHeadChange(callback: () => void): () => void
  }
  locale: {
    get(): SuperOneLocale
    onChange(callback: (locale: SuperOneLocale) => void): () => void
  }
  theme: {
    getVars(): SuperOneThemeVars
    onChange(callback: (vars: SuperOneThemeVars) => void): () => void
  }
  ui: {
    toast(message: string, type?: 'success' | 'error' | 'warning' | 'info'): void
    showTooltip(anchorRect: { x: number; y: number; width: number; height: number }, text: string, side?: 'top' | 'bottom' | 'left' | 'right'): void
    hideTooltip(): void
    startDrag(paths: string | string[], opts?: { iconPng?: ArrayBuffer; scaleFactor?: number }): void
    showContextMenu(position: { x: number; y: number }, items: SuperOneContextMenuItem[]): Promise<string | null>
    showPopover(options: {
      template: string
      data?: unknown
      anchorRect: { x: number; y: number; width: number; height: number }
      side?: 'top' | 'bottom' | 'left' | 'right'
      align?: 'start' | 'center' | 'end'
      width?: number
      maxHeight?: number
    }): SuperOnePopoverHandle
  }
  popover?: SuperOnePopoverApi
  tool?: SuperOneToolRendererApi
  worker: {
    start(): Promise<SuperOneWorkerStatus>
    stop(): Promise<SuperOneWorkerStatus>
    status(): Promise<SuperOneWorkerStatus>
    postMessage(msg: unknown): void
    onMessage(handler: (msg: unknown) => void): () => void
  }
  self?: SuperOneSelfApi
  isDarkMode(): boolean
  onDarkModeChange(callback: (isDark: boolean) => void): () => void
}
