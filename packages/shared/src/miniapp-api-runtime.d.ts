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

export type ToolRendererApi = ToolInterceptApi | ToolResultApi

export interface SuperoneApi {
  version: string
  tools: { handle(name: string, callback: (args: Record<string, unknown>) => unknown): void }
  onInit(callback: (data: Record<string, unknown>) => void): void
  db: {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[] | Record<string, unknown>): Promise<T[]>
    exec(sql: string, params?: unknown[] | Record<string, unknown>): Promise<{ changes: number; lastInsertRowid: number }>
    batch(statements: Array<{ sql: string; params?: unknown[] | Record<string, unknown> }>): Promise<Array<{ changes: number; lastInsertRowid: number }>>
    pragma<T = unknown>(name: string, value?: string | number): Promise<T>
  }
  fs: {
    readFile(path: string, opts?: { binary?: boolean }): Promise<string | ArrayBuffer>
    readDir(path?: string): Promise<Array<{ name: string; isDir: boolean }>>
    writeFile(path: string, content: string | ArrayBuffer | Uint8Array): Promise<void>
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
}

export function createSuperoneApi(transport: MiniAppTransport, version: string, opts?: { initialLocale?: MiniAppLocale }): SuperoneApi
export function startSuperoneResize(transport: MiniAppTransport): void
export function installSuperoneMediaProbe(transport: MiniAppTransport): void
