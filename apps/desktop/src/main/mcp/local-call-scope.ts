/**
 * Make every tool call on one SuperOne MCP instance say who it is for.
 *
 * The instance is reached three ways — the Claude SDK holds it directly, the
 * HTTP transport dispatches into it, and the stdio bridge calls the tool
 * surface — and only the last had a call scope. Without one
 * `currentCallOwner()` reports `undefined`, which means "no idea", so a
 * producer the call reaches marks nothing and the session's zone directory is
 * kept by the reclaim sweep forever (`session-sync-zone.md` §7).
 *
 * Binding it to the instance rather than to each tool covers dynamically
 * registered tools too, and cannot be forgotten when a new register*Tools
 * helper is added. A Host Action that already opened a scope keeps it:
 * `runInLocalCallScope` is a pass-through when a call is already in progress,
 * so a remote session's connection id is never replaced with `local`.
 *
 * Two seams, because there are two ways a tool call can reach code:
 *
 * - **The registrars.** `registerTool` / `tool` wrap the callback, which covers
 *   anything that invokes a registered tool.
 * - **The `tools/call` protocol handler.** Not every call reaches a registered
 *   callback: the compact browser surface installs its own handler so an
 *   unlisted legacy `browser_*` alias from an old transcript still runs, and
 *   that branch calls the union executor directly. Wrapping `setRequestHandler`
 *   rather than the handler it installs is what makes this hold — the fallback
 *   is installed *after* binding and replaces whatever was there, so a wrapper
 *   applied once to the then-current handler would simply be dropped.
 *
 * Both firing for one call is harmless; the inner one is the pass-through.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { runInLocalCallScope } from './artifact-registry'

export type AnyFn = (...args: unknown[]) => unknown

/** The two registration APIs the register*Tools helpers use; both take the callback last. */
const REGISTRARS = ['registerTool', 'tool'] as const

interface InnerServer {
  setRequestHandler?: (schema: unknown, handler: AnyFn) => unknown
}

/** The SDK derives a method string from the request schema's literal `method` field. */
function methodOf(schema: unknown): unknown {
  return (schema as { shape?: { method?: { value?: unknown } } })?.shape?.method?.value
}

export function bindLocalCallScope(server: McpServer, sessionId: string): void {
  const target = server as unknown as Record<string, AnyFn>
  for (const name of REGISTRARS) {
    const original = target[name]
    if (typeof original !== 'function') continue
    const bound = original.bind(server)
    target[name] = (...args: unknown[]) => {
      const last = args.length - 1
      const callback = args[last]
      if (typeof callback !== 'function') return bound(...args)
      const wrapped = (...callArgs: unknown[]) =>
        runInLocalCallScope(sessionId, async () => (callback as AnyFn)(...callArgs))
      return bound(...args.slice(0, last), wrapped)
    }
  }

  wrapToolsCallHandler(server, (handler) =>
    (...args: unknown[]) => runInLocalCallScope(sessionId, async () => handler(...args)))
}

/**
 * Wrap every `tools/call` protocol handler this instance installs, now or
 * later. Call before the first tool is registered: the SDK installs its
 * handler on the first registration. Wrappers compose; the first applied runs
 * outermost.
 */
export function wrapToolsCallHandler(server: McpServer, wrap: (handler: AnyFn) => AnyFn): void {
  const inner = (server as unknown as { server?: InnerServer }).server
  const setHandler = inner?.setRequestHandler
  if (!inner || typeof setHandler !== 'function') return
  const boundSet = setHandler.bind(inner)
  inner.setRequestHandler = (schema: unknown, handler: AnyFn) => {
    if (methodOf(schema) !== 'tools/call' || typeof handler !== 'function') return boundSet(schema, handler)
    return boundSet(schema, wrap(handler))
  }
}
