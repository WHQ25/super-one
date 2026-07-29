import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z, toJSONSchema, type ZodTypeAny } from 'zod'
import {
  ComputerUseService,
  type ComputerUseServiceOptions,
} from './computer-use-service'
import { createComputerUseService } from './create-service'
import { ensureComputerUseAppGrant } from './grant-request'
import { ComputerUseError, type Condition } from './types'
import type { SuperoneMcpToolDescriptor } from '../mcp/superone-mcp-types'
import { readAppSettings } from '../app-settings-service'
import { persistComputerUseScreenshot, COMPUTER_USE_SCREENSHOT_DIR } from './screenshot-store'
import type { CapturedImage } from './types'

export const COMPUTER_USE_TOOL_NAMES = [
  'computer_apps',
  'computer_observe',
  'computer_zoom',
  'computer_query',
  'computer_act',
  'computer_wait_for',
] as const

export type ComputerUseToolName = (typeof COMPUTER_USE_TOOL_NAMES)[number]

export function isComputerUseToolName(name: string): name is ComputerUseToolName {
  return (COMPUTER_USE_TOOL_NAMES as readonly string[]).includes(name)
}

export type ComputerUseToolReply = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function textReply(data: unknown): ComputerUseToolReply {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
}

/**
 * Persist capture pixels to disk (and downscale/JPEG when oversized — media-gen pattern).
 * Returns path-only image for the agent; never multi-MB base64 in the tool JSON.
 */
function toAgentImage(
  image: CapturedImage | undefined,
  screenshotDir: string,
): CapturedImage | undefined {
  if (!image) return undefined
  if (image.path && !image.data) {
    return {
      mimeType: image.mimeType,
      path: image.path,
      width: image.width,
      height: image.height,
    }
  }
  if (image.data) {
    const persisted = persistComputerUseScreenshot(
      image.data,
      image.mimeType,
      { width: image.width, height: image.height },
      { dir: screenshotDir },
    )
    if (persisted) {
      return {
        mimeType: persisted.mimeType,
        path: persisted.path,
        width: persisted.width,
        height: persisted.height,
      }
    }
  }
  // Persist failed or placeholder without real base64 — still omit multi-MB data.
  return {
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    ...(image.path ? { path: image.path } : {}),
  }
}

/** Swap in path-only (possibly JPEG-optimized) image; keep capture coordinateSpace. */
function withAgentImages<T extends { image?: CapturedImage }>(result: T, screenshotDir: string): T {
  if (!result.image) return result
  return { ...result, image: toAgentImage(result.image, screenshotDir) }
}

function errorReply(err: unknown): ComputerUseToolReply {
  if (err instanceof ComputerUseError) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: err.code,
          message: err.message,
          details: err.details,
        }),
      }],
      isError: true,
    }
  }
  return {
    content: [{ type: 'text', text: `[Error] ${err instanceof Error ? err.message : String(err)}` }],
    isError: true,
  }
}

function zodShapeToJsonSchema(shape: Record<string, ZodTypeAny>): Record<string, unknown> {
  const schema = toJSONSchema(z.object(shape)) as Record<string, unknown>
  const { $schema: _schema, ...rest } = schema
  return rest
}

const actionSchema = z.object({
  type: z.enum([
    'press',
    'click',
    'setText',
    'typeText',
    'keypress',
    'scroll',
    'drag',
    'moveMouse',
  ]),
  ref: z.string().optional(),
  text: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  button: z.enum(['left', 'right']).optional(),
  keys: z.array(z.string()).optional(),
  dx: z.number().optional(),
  dy: z.number().optional(),
  path: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
})

const conditionSchema = z.object({
  kind: z.enum(['exists', 'notExists', 'textEquals', 'textContains', 'valueEquals']),
  ref: z.string().optional(),
  text: z.string().optional(),
  value: z.string().optional(),
})

const toolDefs: Array<{
  name: ComputerUseToolName
  description: string
  shape: Record<string, ZodTypeAny>
}> = [
  {
    name: 'computer_apps',
    description:
      'List granted apps, running desktop apps, frontmost app, and discoverable UI roots (`roots[].rootId` like @r1). '
      + 'Pass rootId to computer_observe to target a specific window (not just frontmost). '
      + 'Optionally unhide/launch an app without stealing the user\'s frontmost app. '
      + 'Prefer observe+act with delivery=app-directed over focus — background control is the default. '
      + 'Use this first to learn what Computer Use is allowed to touch. '
      + 'Prefer browser_* for web pages and Bash/file tools when a non-GUI path exists — Computer Use is a fallback tier.',
    shape: {
      action: z.enum(['list', 'focus', 'launch']).optional().describe('Default list'),
      app: z.string().optional().describe('App name or bundle id for focus/launch'),
    },
  },
  {
    name: 'computer_observe',
    description:
      'Capture an immutable UI observation and return stateId. All subsequent query/act/wait_for calls must reference this stateId. '
      + 'mode=visual (and fused) saves the image to a temporary file and returns image.path (not base64). '
      + 'The image is NOT loaded into your context automatically; call Read on image.path if you need to look at pixels, or leave the path as a record for the user. '
      + 'mode=semantic returns accessibility outline with @eN refs (no image). mode=fused = screenshot + AX. '
      + 'Use computer_query on the cached outline for search/expand/inspect without recapturing. '
      + 'capture=window (default) captures only the selected window; coordinates are local to that image and remain valid if the window moves. '
      + 'Use capture=display explicitly when the whole display is required. If the window is resized or moves to a different display scale, input fails closed and a successor observation is created.',
    shape: {
      root: z.string().optional().describe('Root id from computer_apps / prior observe (@rN). Defaults to focused root.'),
      mode: z.enum(['visual', 'semantic', 'fused']).optional().describe('Default fused'),
      capture: z.enum(['window', 'display']).optional().describe('Default window; use display for the full target display'),
    },
  },
  {
    name: 'computer_zoom',
    description:
      'Re-sample a region of the last observation at higher detail, preserving its window/display scope. '
      + 'Saves the image to a temporary file and returns image.path (not base64); Read the path if you need pixels. '
      + 'Does NOT create a new coordinate space — click coordinates still use the parent stateId space.',
    shape: {
      stateId: z.string().describe('Parent observation stateId'),
      region: z
        .tuple([z.number(), z.number(), z.number(), z.number()])
        .describe('[x0, y0, x1, y1] in parent coordinate space'),
    },
  },
  {
    name: 'computer_query',
    description:
      'Search / expand / inspect the cached outline for a stateId without recapturing the desktop. '
      + 'Use this for progressive disclosure of deep accessibility trees.',
    shape: {
      stateId: z.string(),
      op: z.enum(['search', 'expand', 'inspect']),
      text: z.string().optional().describe('For search'),
      ref: z.string().optional().describe('For expand/inspect (@eN)'),
      depth: z.number().int().min(1).max(20).optional().describe('For expand'),
    },
  },
  {
    name: 'computer_act',
    description:
      'Submit 1–20 related UI actions as a checked transaction against a stateId. '
      + 'Default delivery=app-directed posts input to the target app PID in the background '
      + '(does not steal the user\'s frontmost app or require computer_apps focus). '
      + 'Actions: click, typeText, keypress, scroll(dx,dy), drag(path≥2 points), moveMouse, press/setText (AX). '
      + 'scroll: positive dy scrolls content down; optional ref uses element center. '
      + 'drag: path is capture-space points; virtual cursor animates along the path. '
      + 'Use delivery=physical only for global HID when app-directed fails (requires frontmost; disruptive). '
      + 'Returns outcome worked|didnt|unknown based on re-observation, not API success codes. '
      + 'When the successor has pixels, successorImage.path contains the fresh screenshot. '
      + 'Stale stateId (UI changed since observe) is rejected before side effects. '
      + 'delivery=semantic never silently upgrades to app-directed/physical input.',
    shape: {
      stateId: z.string(),
      actions: z.array(actionSchema).min(1).max(20),
      expect: conditionSchema.optional().describe('Postcondition checked after actions'),
      delivery: z
        .enum(['semantic', 'app-directed', 'physical'])
        .optional()
        .describe(
          'Default app-directed (background postToPid). physical=global HID+frontmost. semantic requires AX (P3).',
        ),
    },
  },
  {
    name: 'computer_wait_for',
    description:
      'Wait until a UI condition holds. Distinguishes preexisting (already true) from verified (became true). '
      + 'Do not sleep+poll with observe yourself.',
    shape: {
      stateId: z.string(),
      condition: conditionSchema,
      timeoutMs: z.number().int().min(100).max(60_000).optional().describe('Default 5000'),
    },
  },
]

function parseCondition(raw: unknown): Condition | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const c = raw as Record<string, unknown>
  const kind = c.kind
  if (kind === 'exists' || kind === 'notExists') {
    if (typeof c.ref !== 'string') throw new ComputerUseError('INVALID_ACTION', 'condition.ref required')
    return { kind, ref: c.ref }
  }
  if (kind === 'textEquals' || kind === 'textContains') {
    if (typeof c.ref !== 'string' || typeof c.text !== 'string') {
      throw new ComputerUseError('INVALID_ACTION', 'condition.ref and text required')
    }
    return { kind, ref: c.ref, text: c.text }
  }
  if (kind === 'valueEquals') {
    if (typeof c.ref !== 'string' || typeof c.value !== 'string') {
      throw new ComputerUseError('INVALID_ACTION', 'condition.ref and value required')
    }
    return { kind, ref: c.ref, value: c.value }
  }
  throw new ComputerUseError('INVALID_ACTION', `unknown condition.kind: ${String(kind)}`)
}

/** Build stable MCP tool descriptors (schema only). */
export function getComputerUseToolDescriptors(): SuperoneMcpToolDescriptor[] {
  return toolDefs.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodShapeToJsonSchema(t.shape),
  }))
}

/**
 * Register computer_* tools on an in-process McpServer (Claude / OpenCode SDK path).
 * No-op when Computer Use is disabled — matching collaboration tool gating.
 */
export function registerComputerUseTools(
  server: McpServer,
  sessionId: string,
): void {
  if (!isComputerUseEnabled()) return

  for (const def of toolDefs) {
    const schema = z.object(def.shape)
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.shape },
      async (args: Record<string, unknown>) => {
        try {
          const parsed = schema.parse(args ?? {}) as Record<string, unknown>
          return await executeComputerUseTool(sessionId, def.name, parsed)
        } catch (err) {
          return errorReply(err)
        }
      },
    )
  }
}

export interface ComputerUseToolHost {
  getService(sessionId: string): ComputerUseService
}

export interface ComputerUseToolExecutionContext {
  host?: ComputerUseToolHost
}

const defaultServices = new Map<string, ComputerUseService>()

export function getOrCreateComputerUseService(
  sessionId: string,
  options?: ComputerUseServiceOptions & { backend?: 'fake' | 'macos' | 'auto' },
): ComputerUseService {
  let s = defaultServices.get(sessionId)
  if (!s) {
    s = createComputerUseService({ sessionId, ...options })
    defaultServices.set(sessionId, s)
  }
  return s
}

export function clearComputerUseServices(): void {
  for (const s of defaultServices.values()) s.reset()
  defaultServices.clear()
  resetModuleGate()
}

/**
 * Hide software cursor + menu-bar control chip.
 * Call when the agent is no longer controlling: turn ended, interrupted, idle,
 * session disposed, or Computer Use disabled.
 *
 * @param sessionId When set, clear that session's service first; always also
 *   pokes the shared macOS helper so a stale chip cannot linger.
 */
export async function hideComputerUseVisuals(sessionId?: string): Promise<void> {
  if (sessionId) {
    const s = defaultServices.get(sessionId)
    if (s) {
      try {
        await s.clearVisuals()
      } catch {
        // ignore
      }
    }
  } else {
    for (const s of defaultServices.values()) {
      try {
        await s.clearVisuals()
      } catch {
        // ignore
      }
    }
  }
  // Shared helper may still be painting from a previous act even if the session
  // map entry is gone — force-hide on the socket.
  if (process.platform === 'darwin') {
    try {
      const { getSharedHelperClient } = await import('./platform/macos-helper-client')
      await getSharedHelperClient().call('overlay_hide', { delayMs: 0 })
    } catch {
      // helper offline
    }
  }
}

/** Feature gate — default off. Reads AppSettings.computerUseEnabled unless overridden in tests. */
let enabledOverride: boolean | null = null
let allowAllOverride: boolean | null = null

export function isComputerUseEnabled(): boolean {
  if (enabledOverride !== null) return enabledOverride
  try {
    return readAppSettings().computerUseEnabled === true
  } catch {
    return false
  }
}

export function isComputerUseAllowAllApps(): boolean {
  if (allowAllOverride !== null) return allowAllOverride
  try {
    return readAppSettings().computerUseAllowAllApps === true
  } catch {
    return false
  }
}

/** Test settings bridge. */
export function setComputerUseEnabledForTests(enabled: boolean | null): void {
  enabledOverride = enabled
}

export function setComputerUseAllowAllAppsForTests(allowAll: boolean | null): void {
  allowAllOverride = allowAll
}

function resetModuleGate(): void {
  enabledOverride = null
  allowAllOverride = null
}

function syncPolicyFromSettings(service: ComputerUseService): void {
  let alwaysAllowApps: Array<{ app: string; bundleId: string }> = []
  try {
    alwaysAllowApps = readAppSettings().computerUseAlwaysAllowApps ?? []
  } catch {
    alwaysAllowApps = []
  }
  service.syncSettingsFlags({
    enabled: isComputerUseEnabled(),
    allowAllApps: isComputerUseAllowAllApps(),
    alwaysAllowApps,
  })
}

/** Re-apply AppSettings always-allow list on every live session service. */
export function syncAllComputerUseServicesFromSettings(): void {
  for (const service of defaultServices.values()) {
    syncPolicyFromSettings(service)
  }
}

async function ensureGrantForRoot(
  sessionId: string,
  service: ComputerUseService,
  toolName: string,
  rootId?: string,
): Promise<void> {
  const root = await service.resolveTargetRoot(rootId)
  await ensureComputerUseAppGrant({
    sessionId,
    service,
    app: root.app,
    bundleId: root.bundleId,
    toolName,
  })
}

async function ensureGrantForState(
  sessionId: string,
  service: ComputerUseService,
  toolName: string,
  stateId: string,
): Promise<void> {
  const state = service.getStateStore().get(stateId)
  if (!state) {
    throw new ComputerUseError('UNKNOWN_STATE', `Unknown stateId ${stateId}`, { stateId })
  }
  await ensureComputerUseAppGrant({
    sessionId,
    service,
    app: state.root.app,
    bundleId: state.root.bundleId,
    toolName,
  })
}

export async function executeComputerUseTool(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  context: ComputerUseToolExecutionContext = {},
): Promise<ComputerUseToolReply> {
  if (!isComputerUseToolName(toolName)) {
    throw new Error(`Unknown computer use tool: ${toolName}`)
  }

  const service = context.host?.getService(sessionId) ?? getOrCreateComputerUseService(sessionId)
  const screenshotDir = COMPUTER_USE_SCREENSHOT_DIR

  // Keep policy in sync with settings for default host path.
  syncPolicyFromSettings(service)

  try {
    switch (toolName) {
      case 'computer_apps': {
        const action = (args.action as 'list' | 'focus' | 'launch' | undefined) ?? 'list'
        if (action === 'focus' || action === 'launch') {
          const appArg = args.app as string | undefined
          if (!appArg) {
            throw new ComputerUseError('INVALID_ACTION', `${action} requires app`)
          }
          const identity = await service.resolveAppIdentity(appArg)
          await ensureComputerUseAppGrant({
            sessionId,
            service,
            app: identity.app,
            bundleId: identity.bundleId,
            toolName,
          })
        }
        const result = await service.apps(action, args.app as string | undefined)
        // After focus/launch, promote grant to the real running bundle id if we learned it.
        if ((action === 'focus' || action === 'launch') && typeof args.app === 'string') {
          try {
            const resolved = await service.resolveAppIdentity(args.app)
            if (!service.policy.isGranted(resolved.bundleId)) {
              service.policy.grantSession({
                app: resolved.app,
                bundleId: resolved.bundleId,
                tier: 'full',
              })
            }
          } catch {
            // ignore re-resolve failures
          }
        }
        return textReply(result)
      }
      case 'computer_observe': {
        await ensureGrantForRoot(
          sessionId,
          service,
          toolName,
          args.root as string | undefined,
        )
        const result = await service.observe(
          args.root as string | undefined,
          (args.mode as 'visual' | 'semantic' | 'fused' | undefined) ?? 'fused',
          (args.capture as 'window' | 'display' | undefined) ?? 'window',
        )
        const agentResult = withAgentImages(result, screenshotDir)
        // Persist path onto stored state so later UI can resolve the same file.
        if (agentResult.image?.path) {
          service.alignStateVisual(result.stateId, agentResult.image)
        }
        return textReply(agentResult)
      }
      case 'computer_zoom': {
        const region = args.region as [number, number, number, number]
        if (!Array.isArray(region) || region.length !== 4) {
          throw new ComputerUseError('INVALID_ACTION', 'region must be [x0,y0,x1,y1]')
        }
        await ensureGrantForState(sessionId, service, toolName, String(args.stateId))
        const result = await service.zoom(String(args.stateId), region)
        return textReply(withAgentImages(result, screenshotDir))
      }
      case 'computer_query': {
        // Read-only on cached state — grant already required to create the state.
        const result = await service.query(
          String(args.stateId),
          args.op as 'search' | 'expand' | 'inspect',
          {
            text: args.text as string | undefined,
            ref: args.ref as string | undefined,
            depth: args.depth as number | undefined,
          },
        )
        return textReply(result)
      }
      case 'computer_act': {
        await ensureGrantForState(sessionId, service, toolName, String(args.stateId))
        const result = await service.act(String(args.stateId), args.actions, {
          expect: parseCondition(args.expect),
          delivery: args.delivery as 'semantic' | 'app-directed' | 'physical' | undefined,
        })
        const successorImage = toAgentImage(result.successorImage, screenshotDir)
        if (successorImage?.path) {
          service.alignStateVisual(result.successorStateId, successorImage)
        }
        return textReply({ ...result, successorImage })
      }
      case 'computer_wait_for': {
        const condition = parseCondition(args.condition)
        if (!condition) {
          throw new ComputerUseError('INVALID_ACTION', 'condition is required')
        }
        await ensureGrantForState(sessionId, service, toolName, String(args.stateId))
        const result = await service.waitFor(
          String(args.stateId),
          condition,
          typeof args.timeoutMs === 'number' ? args.timeoutMs : 5000,
        )
        return textReply(result)
      }
      default: {
        const _n: never = toolName
        throw new Error(`Unhandled tool: ${_n}`)
      }
    }
  } catch (err) {
    return errorReply(err)
  }
}
