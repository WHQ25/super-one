/**
 * Development debugging for mini-app WebViews: fixture-driven tool UI previews
 * and a full reload (views + MiniApp Host). The views themselves are driven with
 * the regular `browser_*` tools through `miniapp:` view ids.
 */

import type { MiniAppManifest, MiniAppToolDefinition, MiniAppToolPreviewPhase, MiniAppToolPreviewRequest } from '@superone/shared/miniapp-types'
import { getAppBasePath, isActiveDevApp, readManifest } from '../miniapp/miniapp-service'
import { browserAutomationCall } from '../browser/browser-automation-bridge'
import { miniappErrorReply, miniappTextReply, type MiniappToolReply } from './miniapp-mcp-tools'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

export interface MiniAppDevPreviewArgs {
  appId: string
  tool: string
  phase?: MiniAppToolPreviewPhase
  input?: Record<string, unknown>
  result?: unknown
  running?: boolean
  width?: number
}

export interface MiniAppDevReloadArgs {
  appId: string
}

/** Restarts a development Host from its current code; false when none was running. */
export type MiniAppHostReloader = (projectDir: string, appId: string) => Promise<boolean>

let hostReloader: MiniAppHostReloader | null = null

export function setMiniAppHostReloader(reloader: MiniAppHostReloader | null): void {
  hostReloader = reloader
}

function sessionProjectDir(deps: BuiltInSuperoneToolDeps): string {
  const projectDir = deps.sessionHost?.getSession(deps.sessionId)?.projectPath
  if (!projectDir) throw new Error('Mini-app development tools need a session with a project.')
  return projectDir
}

async function devManifest(appId: string): Promise<MiniAppManifest> {
  if (!(await isActiveDevApp(appId))) {
    throw new Error(`Mini-app ${appId} is not an active development app. Register it with miniapp_dev_register (installed apps are not exposed).`)
  }
  const manifest = await readManifest(getAppBasePath(appId))
  if (!manifest) throw new Error(`Mini-app ${appId} has no readable manifest in its development build.`)
  return manifest
}

/** Phases chat can show for this tool, in the order chat reaches them. */
export function previewPhasesFor(tool: MiniAppToolDefinition): MiniAppToolPreviewPhase[] {
  const phases: MiniAppToolPreviewPhase[] = []
  if (tool.renderer?.intercept) phases.push('intercept')
  if (tool.renderer?.result) phases.push(tool.standalone ? 'standalone' : 'result')
  return phases
}

function previewRequest(manifest: MiniAppManifest, args: MiniAppDevPreviewArgs): MiniAppToolPreviewRequest {
  const tool = manifest.tools?.find((candidate) => candidate.name === args.tool)
  const withUi = (manifest.tools ?? []).filter((candidate) => previewPhasesFor(candidate).length > 0).map((candidate) => candidate.name)
  if (!tool) throw new Error(`Tool ${args.tool} is not declared by ${manifest.appId}. Tools with UI: ${withUi.join(', ') || 'none'}.`)
  const phases = previewPhasesFor(tool)
  if (phases.length === 0) throw new Error(`Tool ${args.tool} has no renderer to preview. Tools with UI: ${withUi.join(', ') || 'none'}.`)
  const phase = args.phase ?? phases[phases.length - 1]
  if (!phases.includes(phase)) throw new Error(`Tool ${args.tool} has no ${phase} UI; available phases: ${phases.join(', ')}.`)
  const templateKey = phase === 'intercept' ? tool.renderer?.intercept?.template : tool.renderer?.result?.template
  const templatePath = templateKey ? manifest.templates?.[templateKey] : undefined
  if (!templatePath) throw new Error(`Template "${templateKey}" of ${args.tool} is missing from manifest.templates.`)
  return {
    appId: manifest.appId,
    appName: manifest.name,
    tool: tool.name,
    toolLabel: tool.displayName ?? tool.name,
    phase,
    templatePath,
    input: args.input ?? {},
    ...(args.result !== undefined ? { result: args.result } : {}),
    running: args.running === true,
    ...(args.width !== undefined ? { width: args.width } : {}),
  }
}

export async function miniappDevPreviewHandler(args: MiniAppDevPreviewArgs, deps: BuiltInSuperoneToolDeps): Promise<MiniappToolReply> {
  try {
    sessionProjectDir(deps)
    const request = previewRequest(await devManifest(args.appId), args)
    const shown = await browserAutomationCall(deps.sessionId, 'miniappPreview', request) as { target: string }
    return miniappTextReply({
      status: 'previewing',
      target: shown.target,
      tool: request.tool,
      phase: request.phase,
      next: `Drive it with browser_* tools using tab "${shown.target}". The tool does not run; submit/cancel/close are logged as info console entries.`,
    })
  } catch (error) {
    return miniappErrorReply(error)
  }
}

export async function miniappDevReloadHandler(args: MiniAppDevReloadArgs, deps: BuiltInSuperoneToolDeps): Promise<MiniappToolReply> {
  try {
    const projectDir = sessionProjectDir(deps)
    await devManifest(args.appId)
    if (!hostReloader) throw new Error('MiniApp Host reload is unavailable')
    const hostRestarted = await hostReloader(projectDir, args.appId)
    const views = await browserAutomationCall(deps.sessionId, 'miniappReload', { appId: args.appId }) as {
      reloadedViews: number
      notReloaded?: Array<{ tab: string; error: string }>
    }
    return miniappTextReply({ status: 'reloaded', appId: args.appId, hostRestarted, ...views })
  } catch (error) {
    return miniappErrorReply(error)
  }
}
