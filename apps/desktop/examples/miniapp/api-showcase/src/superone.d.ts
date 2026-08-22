interface SuperOneThemeVars {
  [key: string]: string
}

type SuperOneLocale = 'en' | 'zh'

interface SuperOneContextMenuItem {
  id: string
  label: string
  icon?: string
  disabled?: boolean
  variant?: 'default' | 'destructive'
  separator?: boolean
  group?: string
}

interface SuperOnePopoverHandle {
  postMessage(data: unknown): void
  onMessage(callback: (data: unknown) => void): void
  close(): void
  onClose(callback: () => void): void
}

interface SuperOnePopoverApi {
  readonly data: unknown
  postMessage(data: unknown): void
  onMessage(callback: (data: unknown) => void): void
  close(): void
}

interface SuperOneToolInterceptApi {
  readonly phase: 'intercept'
  readonly callId: string
  readonly toolName: string
  readonly data: unknown
  submit(userInput: Record<string, unknown>): void
  cancel(reason?: string | null): void
}

interface SuperOneToolResultApi {
  readonly phase: 'result'
  readonly callId: string
  readonly toolName: string
  readonly data: unknown
  close(): void
}

interface SuperOneToolStandaloneApi {
  readonly phase: 'standalone'
  readonly callId: string
  readonly toolName: string
  getState(): { args: Record<string, unknown> | null; result: unknown; error: string | null }
  onDidChange(callback: (state: { args: Record<string, unknown> | null; result: unknown; error: string | null }) => void): () => void
}

type SuperOneToolRendererApi = SuperOneToolInterceptApi | SuperOneToolResultApi | SuperOneToolStandaloneApi

interface SuperOneNodeBridge {
  postMessage(message: unknown): void
  onMessage(handler: (message: unknown) => void): () => void
}

interface SuperOne {
  readonly version: string
  readonly node: SuperOneNodeBridge
  locale: {
    get(): SuperOneLocale
    onChange(callback: (locale: SuperOneLocale) => void): () => void
  }
  theme: {
    getVars(): SuperOneThemeVars
    onChange(callback: (vars: SuperOneThemeVars) => void): () => void
  }
  ui: {
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
  isDarkMode(): boolean
  onDarkModeChange(callback: (isDark: boolean) => void): () => void
}

declare global {
  interface Window {
    superone: SuperOne
  }
}

export {}
