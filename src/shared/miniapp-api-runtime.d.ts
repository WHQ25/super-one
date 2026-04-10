export interface MiniAppTransport {
  send(type: string, data: Record<string, unknown>): void
  request(reqType: string, resType: string, data: Record<string, unknown>, resultKey?: string): Promise<unknown>
  on(type: string, handler: (data: Record<string, unknown>) => void): void
}

export interface SuperoneApi {
  tools: { handle(name: string, callback: (args: Record<string, unknown>) => unknown): void }
  onInit(callback: (data: Record<string, unknown>) => void): void
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
  agent: { sendPrompt(text: string): void }
  openFolder(path: string): void
  openExternalLink(url: string): void
  clipboard: {
    read(): Promise<string>
    write(text: string): void
  }
  git: {
    info(): Promise<unknown>
    branches(): Promise<unknown>
    log(opts?: { limit?: number }): Promise<unknown>
    status(): Promise<unknown>
    diff(path: string, staged?: boolean): Promise<unknown>
    show(ref: string, path: string): Promise<unknown>
    onHeadChange(cb: () => void): () => void
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
  }
  isDarkMode(): boolean
  onDarkModeChange(cb: (isDark: boolean) => void): () => void
}

export function createSuperoneApi(transport: MiniAppTransport): SuperoneApi
export function startSuperoneResize(transport: MiniAppTransport): void
