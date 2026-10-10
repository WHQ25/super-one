import type { DeliveryPolicy, TopicConnection } from '@superone/runtime/stream'
import type { SessionRef, TerminalRef } from '@superone/shared/environment/refs'
import { sessionKey, terminalKey } from '@superone/shared/environment/refs'
import type { TopicRef } from '@superone/shared/environment/topics'

/**
 * The renderer connection's topics: the union of what the open windows show.
 * Every window has the sidebar and terminal panel, which show every local
 * session and terminal; panes, tiles and mini windows each show a session
 * (`ChatContent` reports it); a remote session reaches the chat while this
 * desktop follows it. Delivery to windows stays a broadcast: session windows
 * follow side chats and draft-to-session id changes on their own.
 */
export class RendererInterest {
  /** Window id → shown session key → number of views. */
  private readonly windows = new Map<number, Map<string, { ref: SessionRef; views: number }>>()
  private readonly followed = new Map<string, SessionRef>()
  private readonly terminals = new Map<string, TerminalRef>()

  constructor(
    private readonly connection: TopicConnection<DeliveryPolicy>,
    private readonly localEnvironmentId: string,
  ) {
    const environmentId = localEnvironmentId
    for (const topic of [
      { kind: 'session', environmentId, sessionId: '*' },
      { kind: 'environment', environmentId },
      { kind: 'drafts', environmentId },
      { kind: 'terminal', environmentId, terminalId: '*' },
      { kind: 'terminalList', environmentId },
    ] satisfies TopicRef[]) connection.subscribe(topic)
  }

  /** A view in window `windowId` started or stopped showing a session. */
  setShown(windowId: number, ref: SessionRef, shown: boolean): void {
    let views = this.windows.get(windowId)
    if (!views) this.windows.set(windowId, views = new Map())
    const key = sessionKey(ref)
    const entry = views.get(key) ?? { ref, views: 0 }
    entry.views = Math.max(0, entry.views + (shown ? 1 : -1))
    if (entry.views > 0) views.set(key, entry)
    else views.delete(key)
    if (views.size === 0) this.windows.delete(windowId)
    this.sync()
  }

  /** The window closed; returns what it still showed, one entry per view. */
  closeWindow(windowId: number): SessionRef[] {
    const views = this.windows.get(windowId)
    this.windows.delete(windowId)
    this.sync()
    return [...(views?.values() ?? [])].flatMap((entry) => Array.from({ length: entry.views }, () => entry.ref))
  }

  /** A remote session's events reach the chat while it is followed. */
  follow(ref: SessionRef, followed: boolean): void {
    if (followed) this.followed.set(sessionKey(ref), ref)
    else this.followed.delete(sessionKey(ref))
    this.sync()
  }

  /** A remote terminal attached to a window, or detached. */
  attachTerminal(ref: TerminalRef, attached: boolean): void {
    if (attached) this.terminals.set(terminalKey(ref), ref)
    else this.terminals.delete(terminalKey(ref))
    this.sync()
  }

  /** Sessions some window shows, deduplicated. */
  shown(): SessionRef[] {
    const out = new Map<string, SessionRef>()
    for (const views of this.windows.values()) for (const [key, entry] of views) out.set(key, entry.ref)
    return [...out.values()]
  }

  private sync(): void {
    const sessions = new Map<string, TopicRef>()
    const environments = new Map<string, TopicRef>()
    sessions.set(`${this.localEnvironmentId}:*`, { kind: 'session', environmentId: this.localEnvironmentId, sessionId: '*' })
    environments.set(this.localEnvironmentId, { kind: 'environment', environmentId: this.localEnvironmentId })
    for (const ref of [...this.shown(), ...this.followed.values()]) {
      sessions.set(sessionKey(ref), { kind: 'session', ...ref })
      environments.set(ref.environmentId, { kind: 'environment', environmentId: ref.environmentId })
    }
    const terminals: TopicRef[] = [{ kind: 'terminal', environmentId: this.localEnvironmentId, terminalId: '*' }]
    const terminalLists = new Map<string, TopicRef>([[this.localEnvironmentId, { kind: 'terminalList', environmentId: this.localEnvironmentId }]])
    for (const ref of this.terminals.values()) {
      terminals.push({ kind: 'terminal', ...ref })
      terminalLists.set(ref.environmentId, { kind: 'terminalList', environmentId: ref.environmentId })
    }
    this.connection.replace('session', [...sessions.values()])
    this.connection.replace('environment', [...environments.values()])
    this.connection.replace('terminal', terminals)
    this.connection.replace('terminalList', [...terminalLists.values()])
  }
}
