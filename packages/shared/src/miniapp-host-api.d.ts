/**
 * Author-facing types for a mini-app's Node.js MiniApp Host entry (`manifest.main`).
 *
 * Types only — `@superone/shared/miniapp-host-api` has no runtime `default`
 * export, so always `import type`. A value import fails at runtime.
 */
export interface SuperOneMiniAppDisposable {
  dispose(): void | Promise<void>
}

export interface SuperOneMiniAppTools {
  handle(
    name: string,
    handler: (args: Record<string, unknown>) => unknown | Promise<unknown>,
  ): SuperOneMiniAppDisposable
}

export interface SuperOneMiniAppWebview {
  /**
   * Delivered to every mounted WebView of this app; queued until the guest
   * reaches dom-ready. With no WebView open the message is dropped, so treat
   * it as UI notification, not as state transfer.
   */
  postMessage(message: unknown): void
  onMessage(handler: (message: unknown) => void): SuperOneMiniAppDisposable
}

export interface SuperOneMiniAppState {
  get<T = unknown>(key: string): Promise<T | undefined>
  update(key: string, value: unknown | undefined): Promise<void>
  keys(): Promise<string[]>
}

export type SuperOneMiniAppLocale = 'en' | 'zh'

export type SuperOneMiniAppToastType = 'success' | 'error' | 'info' | 'warning'

export interface SuperOneMiniAppClipboard {
  /** Reads the system clipboard. May reject if the user denies the request. */
  read(): Promise<string>
  write(text: string): Promise<void>
}

/**
 * Host actions that need no DOM coordinates. Anything anchored to an element
 * (tooltip, context menu, popover, drag) stays in the WebView, where the
 * coordinates exist.
 */
export interface SuperOneMiniAppHostApi {
  toast(message: string, type?: SuperOneMiniAppToastType): Promise<void>
  /** Reveals a path in Finder / Explorer. Must be inside the app's own scope. */
  revealInFolder(path: string): Promise<void>
  /** Opens an http(s) URL in the system browser, after the user confirms. */
  openExternal(url: string): Promise<void>
  readonly clipboard: SuperOneMiniAppClipboard
}

export interface SuperOneMiniAppAgentApi {
  /** Writes text into the chat input of the session holding this mini-app. */
  sendPrompt(text: string): Promise<void>
  setContext(opts: {
    summary: string
    content: string
    mode?: 'inject' | 'suggest'
    color?: string
  }): Promise<void>
  clearContext(): Promise<void>
  /** Fires once the agent has consumed the context card set above. */
  onContextConsumed(handler: () => void): SuperOneMiniAppDisposable
}

export interface SuperOneMiniAppLocaleApi {
  get(): SuperOneMiniAppLocale
  onChange(handler: (locale: SuperOneMiniAppLocale) => void): SuperOneMiniAppDisposable
}

export interface SuperOneMiniAppWorkspace {
  readonly rootPath: string
  /**
   * Per-project storage directory for this app. Created on demand, so it may
   * not exist yet — `mkdir({ recursive: true })` before writing. `workspaceState`
   * handles this for you.
   */
  readonly storagePath: string
}

/** Runtime context passed to a mini-app's Node.js `activate` function. */
export interface SuperOneMiniAppContext {
  readonly appId: string
  readonly appPath: string
  /** SuperOne version running this mini-app. */
  readonly version: string
  readonly workspace: SuperOneMiniAppWorkspace
  /** Cross-project storage directory. Created on demand — see `workspace.storagePath`. */
  readonly globalStoragePath: string
  readonly workspaceState: SuperOneMiniAppState
  readonly globalState: SuperOneMiniAppState
  readonly tools: SuperOneMiniAppTools
  readonly webview: SuperOneMiniAppWebview
  readonly agent: SuperOneMiniAppAgentApi
  readonly host: SuperOneMiniAppHostApi
  readonly locale: SuperOneMiniAppLocaleApi
  readonly subscriptions: SuperOneMiniAppDisposable[]
  /**
   * Publishes a short status in the sidebar. Also marks this host as doing
   * background work, so quitting SuperOne asks for confirmation. Pass '' when
   * the work is done.
   */
  setStatus(text: string): void
}

export interface SuperOneMiniAppModule {
  activate(context: SuperOneMiniAppContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
