/**
 * SuperOne MCP tools layout_snapshot / layout_act: thin adapters over the renderer's
 * layout control API (docs/features/layout-control.md). Every action is reversible
 * and scoped to the calling session, so none needs a confirmation.
 */
import { encode as toonEncode } from '@toon-format/toon'
import type { LayoutActRequest } from '@superone/shared/layout-control'
import { browserAutomationCall } from '../browser/browser-automation-bridge'
import { currentHostActionConnection } from './artifact-registry'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

export type LayoutSnapshotArgs = Record<string, never>
export type LayoutActArgs = LayoutActRequest

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true as const } : {}),
  }
}

/**
 * A remote node's agent has no SuperOne window of its own to arrange. Answered
 * as a result, not an error, so the agent stops instead of retrying.
 */
function unsupportedOnRemoteNode() {
  if (currentHostActionConnection() === null) return null
  return toolResult({
    status: 'unsupported',
    reason: 'remote_node',
    message: 'Layout control is only available to sessions running on this desktop.',
  })
}

/** The folder relative file paths resolve against: the session's working directory. */
function sessionRoot(deps: BuiltInSuperoneToolDeps): string | undefined {
  const session = deps.sessionHost?.getSession(deps.sessionId) as { cwd?: string; projectPath?: string } | null | undefined
  return session?.cwd || session?.projectPath || undefined
}

function errorText(err: unknown): string {
  return `[Error] ${err instanceof Error ? err.message : String(err)}`
}

export async function layoutSnapshotHandler(_args: LayoutSnapshotArgs, deps: BuiltInSuperoneToolDeps) {
  const unsupported = unsupportedOnRemoteNode()
  if (unsupported) return unsupported
  try {
    const snapshot = await browserAutomationCall(deps.sessionId, 'layoutSnapshot', { root: sessionRoot(deps) })
    return toolResult(toonEncode(snapshot))
  } catch (err) {
    return toolResult(errorText(err), true)
  }
}

export async function layoutActHandler(args: LayoutActArgs, deps: BuiltInSuperoneToolDeps) {
  const unsupported = unsupportedOnRemoteNode()
  if (unsupported) return unsupported
  try {
    return toolResult(await browserAutomationCall(deps.sessionId, 'layoutAct', { root: sessionRoot(deps), request: args }))
  } catch (err) {
    return toolResult(errorText(err), true)
  }
}
