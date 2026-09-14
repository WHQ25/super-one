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
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { runInLocalCallScope } from './artifact-registry'

type AnyFn = (...args: unknown[]) => unknown

/** The two registration APIs the register*Tools helpers use; both take the callback last. */
const REGISTRARS = ['registerTool', 'tool'] as const

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
}
