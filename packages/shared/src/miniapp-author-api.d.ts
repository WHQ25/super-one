import type { SuperOneComposerOpenOptions, SuperOneComposerOutcome, SuperOneComposerSpec } from './composer-api'
export type { SuperOneComposerOpenOptions, SuperOneComposerOutcome, SuperOneComposerSpec } from './composer-api'

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
  getState(): { args: Record<string, unknown> | null; result: unknown; error: string | null }
  onDidChange(callback: (state: { args: Record<string, unknown> | null; result: unknown; error: string | null }) => void): () => void
}

export type SuperOneToolRendererApi = SuperOneToolInterceptApi | SuperOneToolResultApi | SuperOneToolStandaloneApi

export interface SuperOneNodeBridge {
  postMessage(message: unknown): void
  onMessage(handler: (message: unknown) => void): () => void
}

export interface SuperOneComposerApi {
  /**
   * Opens a form in the host-bound session and waits for submission or cancellation.
   * Defaults to caller: submitted values return here. Agent output sends the values
   * to the session and returns submitted status. Invalid or unavailable forms reject.
   * Closing/reloading this surface releases its caller forms. Agent-output forms
   * remain in their session. Waiting for human input has no automatic timeout.
   */
  open(spec: SuperOneComposerSpec, options?: SuperOneComposerOpenOptions): Promise<SuperOneComposerOutcome>
}

export interface SuperOne {
  readonly version: string
  readonly node: SuperOneNodeBridge
  readonly composer: SuperOneComposerApi
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
