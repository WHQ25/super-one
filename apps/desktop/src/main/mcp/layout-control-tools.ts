/**
 * SuperOne MCP tools layout_snapshot / layout_act: thin adapters over the renderer's
 * layout control API (docs/features/layout-control.md). Every action is reversible
 * with an explicit UI target separate from the caller. None needs a confirmation.
 */
import { encode as toonEncode } from '@toon-format/toon'
import { openedTabNote, type LayoutActRequest, type LayoutTarget, type OpenedTabNote, type OpenedTabPresentation } from '@superone/shared/layout-control'
import { browserAutomationCall } from '../browser/browser-automation-bridge'
import { currentHostActionConnection } from './artifact-registry'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

export type LayoutSnapshotArgs = { target?: LayoutTarget }
export type LayoutActArgs = LayoutActRequest

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true as const } : {}),
  }
}

/** Preserve the authenticated Host Action source when resolving caller/localhost. */
async function sourceEnvironmentId(): Promise<string> {
  const { getEnvironmentHost } = await import('../environment/environment-host')
  const connection = currentHostActionConnection() ?? 'local'
  const source = (await getEnvironmentHost().listEnvironments({ includeDescriptors: false })).find(item => item.connectionId === connection)
  if (!source) throw new Error('The invoking session environment is unavailable.')
  return source.environmentId
}

/** The folder relative file paths resolve against: the session's working directory. */
function sessionRoot(deps: BuiltInSuperoneToolDeps): string | undefined {
  const session = deps.sessionHost?.getSession(deps.sessionId) as { cwd?: string; projectPath?: string } | null | undefined
  return session?.cwd || session?.projectPath || undefined
}

/**
 * The note an open result carries when the tab it opened is not in front of the user
 * (see `openedTabNote`); empty when it is, or when there is no desktop window to ask.
 * `pip`: the kind has a picture-in-picture that shows while the panel is closed.
 */
export async function openedTabNoteFor(
  sessionId: string,
  opts: { pip: boolean; bringForward: string },
): Promise<OpenedTabNote | Record<string, never>> {
  if (currentHostActionConnection() !== null) return {}
  try {
    const presentation = await browserAutomationCall(sessionId, 'tabPresentation', { pip: opts.pip }) as OpenedTabPresentation
    return openedTabNote(presentation, opts.bringForward) ?? {}
  } catch {
    // The note is a courtesy; the tab itself opened fine.
    return {}
  }
}

function errorText(err: unknown): string {
  return `[Error] ${err instanceof Error ? err.message : String(err)}`
}

export async function layoutSnapshotHandler(args: LayoutSnapshotArgs, deps: BuiltInSuperoneToolDeps) {
  try {
    const snapshot = await browserAutomationCall(deps.sessionId, 'layoutSnapshot', { environmentId: await sourceEnvironmentId(), root: sessionRoot(deps), target: args.target }, deps.signal)
    return toolResult(toonEncode(snapshot))
  } catch (err) {
    return toolResult(errorText(err), true)
  }
}

export async function layoutActHandler(args: LayoutActArgs, deps: BuiltInSuperoneToolDeps) {
  try {
    return toolResult(await browserAutomationCall(deps.sessionId, 'layoutAct', { environmentId: await sourceEnvironmentId(), root: sessionRoot(deps), request: args }, deps.signal))
  } catch (err) {
    return toolResult(errorText(err), true)
  }
}
