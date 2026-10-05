/**
 * Author-facing types for a mini-app's Node.js MiniApp Host entry (`manifest.main`).
 *
 * Types only — `@superone/shared/miniapp-host-api` has no runtime `default`
 * export, so always `import type`. A value import fails at runtime.
 */
import type { SuperOneComposerOpenOptions, SuperOneComposerOutcome, SuperOneComposerSpec } from './composer-api'

export type * from './composer-api'

export interface SuperOneMiniAppDisposable {
  dispose(): void | Promise<void>
}

/** A session that invoked this app, as SuperOne identified it. */
export interface SuperOneMiniAppSessionRef {
  readonly sessionId: string
}

/** Trusted facts about one tool call, supplied by SuperOne rather than the caller's arguments. */
export interface SuperOneMiniAppToolContext {
  /** The session whose agent called the tool. */
  readonly session: SuperOneMiniAppSessionRef
  readonly callId: string
  /** Aborted when the call ends without a result, e.g. after its 120-second limit. */
  readonly signal: AbortSignal
}

export interface SuperOneMiniAppTools {
  handle(
    name: string,
    handler: (args: Record<string, unknown>, ctx: SuperOneMiniAppToolContext) => unknown | Promise<unknown>,
  ): SuperOneMiniAppDisposable
}

/** Kept for existing apps; the same as `SuperOneComposerSpec`. */
export type SuperOneMiniAppInputRequestSpec = SuperOneComposerSpec
/** Kept for existing apps; the same as `SuperOneComposerOutcome`. */
export type SuperOneMiniAppInputRequestOutcome = SuperOneComposerOutcome

export interface SuperOneMiniAppComposerOpenOptions extends SuperOneComposerOpenOptions {
  /** Defaults to the only session this app is open in; pass `ctx.session` from a tool call. */
  session?: SuperOneMiniAppSessionRef
  /** Closes the form when aborted, e.g. `ctx.signal`. */
  signal?: AbortSignal
}

export interface SuperOneMiniAppComposer {
  /**
   * Shows a form in a session's composer and resolves with the user's answer.
   * `caller` output (the default) returns the values only to this app; `agent`
   * output sends them to the session's agent as a user message and resolves
   * `{ status: 'submitted' }`. There is no deadline, so do not await it inside a
   * tool handler past the call's 120-second limit: start it, return, and handle the
   * outcome later — or pass `ctx.signal` to close the form with the call.
   * Local desktop sessions only. Rejects when the form is invalid or cannot be shown.
   */
  open(spec: SuperOneComposerSpec, options?: SuperOneMiniAppComposerOpenOptions): Promise<SuperOneComposerOutcome>
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
  readonly composer: SuperOneMiniAppComposer
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
