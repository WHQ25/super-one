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
import { encode as toonEncode } from '@toon-format/toon'

export const COMPUTER_USE_TOOL_NAMES = [
  'computer_apps',
  'computer_snapshot',
  'computer_zoom',
  'computer_query',
  'computer_act',
  'computer_wait_for',
] as const

export type ComputerUseToolName = (typeof COMPUTER_USE_TOOL_NAMES)[number]

/** Deprecated MCP names → current. Keep for one release so old agent transcripts still work. */
const COMPUTER_USE_TOOL_ALIASES: Record<string, ComputerUseToolName> = {
  computer_observe: 'computer_snapshot',
}

export function isComputerUseToolName(name: string): name is ComputerUseToolName {
  return (COMPUTER_USE_TOOL_NAMES as readonly string[]).includes(name)
}

export function normalizeComputerUseToolName(name: string): ComputerUseToolName | null {
  if (isComputerUseToolName(name)) return name
  return COMPUTER_USE_TOOL_ALIASES[name] ?? null
}

export type ComputerUseToolReply = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function textReply(data: unknown): ComputerUseToolReply {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
}

/** Uniform flat rows → TOON table (header once + CSV rows). */
function toonReply(data: unknown): ComputerUseToolReply {
  return { content: [{ type: 'text', text: toonEncode(data) }] }
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

const descriptionField = {
  description: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .describe(
      "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Inspect the meeting notes window', 'Save the edited document'). Shown in the UI in place of raw state ids, element refs, and coordinates. Write it in the conversation's language.",
    ),
}

const toolDefs: Array<{
  name: ComputerUseToolName
  description: string
  shape: Record<string, ZodTypeAny>
}> = [
  {
    name: 'computer_apps',
    description:
      'Discover and open desktop apps. '
      + 'action=list (default) returns a compact TOON app catalog: one row per app with app, bundleId, running, frontmost, granted, grantScope, pid, windows. '
      + 'Use query to keyword-filter by display name / bundle id / localized aliases (e.g. query=Notes or com.apple.TextEdit). '
      + 'Paginate with offset + limit (default limit 25, max 100); hasMore means call again with offset+=limit. '
      + 'Rows are sorted running/frontmost/granted first. '
      + 'Do NOT dump every window by default — pass includeRoots=true only when you need @rN roots for multi-window targeting. '
      + 'action=focus|launch accepts display name (any locale) or reverse-DNS bundleId; host resolves to a stable bundleId before the permission grant so one allow covers later snapshot/act. '
      + 'Launch/focus returns a slim {target} confirmation. If the user only asks to open an app, launch once and stop when target is returned. '
      + 'Prefer snapshot+act with delivery=app-directed over focus. Prefer browser_* / shell when a non-GUI path exists.',
    shape: {
      ...descriptionField,
      action: z.enum(['list', 'focus', 'launch']).optional().describe('Default list'),
      app: z
        .string()
        .optional()
        .describe(
          'Display name (any locale) or reverse-DNS bundle id for focus/launch. Prefer bundleId from a prior list when known.',
        ),
      query: z
        .string()
        .optional()
        .describe('list only: keyword filter on app name / bundleId / aliases'),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('list only: pagination offset (default 0)'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('list only: page size (default 25, max 100)'),
      includeRoots: z
        .boolean()
        .optional()
        .describe(
          'list only: also attach discoverable UI roots (@rN). Token-heavy; default false.',
        ),
    },
  },
  {
    name: 'computer_snapshot',
    description:
      'Capture an immutable UI snapshot and return stateId (analogous to browser_snapshot for desktop apps). '
      + 'All subsequent query/act/wait_for calls must reference this stateId. '
      + 'mode=visual (and fused) saves the image to a temporary file and returns image.path (not base64). '
      + 'The image is NOT loaded into your context automatically; call Read on image.path if you need to look at pixels, or leave the path as a record for the user. '
      + 'mode=semantic returns accessibility outline with @eN refs (no image). mode=fused = screenshot + AX. '
      + 'Use computer_query on the cached outline for search/expand/inspect without recapturing. '
      + 'capture=window (default) captures only the selected window; coordinates are local to that image and remain valid if the window moves. '
      + 'Use capture=display explicitly when the whole display is required. If the window is resized or moves to a different display scale, input fails closed and a successor observation is created.',
    shape: {
      ...descriptionField,
      root: z.string().optional().describe('Root id from computer_apps / prior snapshot (@rN). Defaults to focused root.'),
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
      ...descriptionField,
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
      ...descriptionField,
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
      + 'Stale stateId (UI changed since snapshot) is rejected before side effects. '
      + 'delivery=semantic never silently upgrades to app-directed/physical input.',
    shape: {
      ...descriptionField,
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
      + 'Do not sleep+poll with snapshot yourself.',
    shape: {
      ...descriptionField,
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

  // Deprecated alias: computer_observe → computer_snapshot (one release).
  const snapshotDef = toolDefs.find((d) => d.name === 'computer_snapshot')
  if (snapshotDef) {
    const schema = z.object(snapshotDef.shape)
    server.registerTool(
      'computer_observe',
      {
        description:
          '[Deprecated: use computer_snapshot] ' + snapshotDef.description,
        inputSchema: snapshotDef.shape,
      },
      async (args: Record<string, unknown>) => {
        try {
          const parsed = schema.parse(args ?? {}) as Record<string, unknown>
          return await executeComputerUseTool(sessionId, 'computer_snapshot', parsed)
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

/** Drop session grants + state when the chat session is disposed. */
export function disposeComputerUseService(sessionId: string): void {
  const s = defaultServices.get(sessionId)
  if (!s) return
  try {
    s.reset()
  } catch {
    // ignore
  }
  defaultServices.delete(sessionId)
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

const MAX_SESSION_GRANT_APPS = 16

/**
 * Temporary session grants from @ desktop-app mentions — no HITL prompt.
 * Applies to the chat session's Computer Use service (creates it if needed).
 * Returns how many apps were granted (0 if disabled / invalid).
 */
export function grantComputerUseSessionApps(
  sessionId: string,
  apps: Array<{ app: string; bundleId: string }>,
): number {
  if (!sessionId || apps.length === 0) return 0
  if (!isComputerUseEnabled()) return 0
  const service = getOrCreateComputerUseService(sessionId)
  syncPolicyFromSettings(service)
  let granted = 0
  for (const a of apps.slice(0, MAX_SESSION_GRANT_APPS)) {
    const bundleId = typeof a.bundleId === 'string' ? a.bundleId.trim() : ''
    if (!bundleId || bundleId === '*') continue
    // Same safe pattern as icon resolver (reverse-DNS only).
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,253}$/.test(bundleId)) continue
    const app = (typeof a.app === 'string' && a.app.trim()) || bundleId
    service.policy.grantSession({ app, bundleId, tier: 'full' })
    granted += 1
  }
  return granted
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
  const normalized = normalizeComputerUseToolName(toolName)
  if (!normalized) {
    throw new Error(`Unknown computer use tool: ${toolName}`)
  }

  const description = typeof args.description === 'string' ? args.description.trim() : ''
  if (!description || description.length > 160) {
    return errorReply(
      new ComputerUseError(
        'INVALID_ACTION',
        'description is required and must be between 1 and 160 characters',
      ),
    )
  }

  const service = context.host?.getService(sessionId) ?? getOrCreateComputerUseService(sessionId)
  const screenshotDir = COMPUTER_USE_SCREENSHOT_DIR

  // Keep policy in sync with settings for default host path.
  syncPolicyFromSettings(service)

  try {
    switch (normalized) {
      case 'computer_apps': {
        const action = (args.action as 'list' | 'focus' | 'launch' | undefined) ?? 'list'
        if (action === 'focus' || action === 'launch') {
          const appArg = args.app as string | undefined
          if (!appArg) {
            throw new ComputerUseError('INVALID_ACTION', `${action} requires app`)
          }
          // Resolve BEFORE grant so HITL keys on the real reverse-DNS bundle id
          // (not a raw display name that would re-prompt on snapshot).
          const identity = await service.resolveAppIdentity(appArg)
          await ensureComputerUseAppGrant({
            sessionId,
            service,
            app: identity.app,
            bundleId: identity.bundleId,
            toolName: normalized,
          })
          // Pass the stable bundle id into apps() so launch/focus matching is locale-safe.
          // Never auto-grant a different bundleId than the user-approved identity.
          const result = await service.apps(action, identity.bundleId)
          // Slim launch/focus payload — still TOON for consistency.
          return toonReply(result)
        }
        const result = await service.apps('list', undefined, {
          query: typeof args.query === 'string' ? args.query : undefined,
          offset: typeof args.offset === 'number' ? args.offset : undefined,
          limit: typeof args.limit === 'number' ? args.limit : undefined,
          includeRoots: args.includeRoots === true,
        })
        return toonReply(result)
      }
      case 'computer_snapshot': {
        await ensureGrantForRoot(
          sessionId,
          service,
          normalized,
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
        await ensureGrantForState(sessionId, service, normalized, String(args.stateId))
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
        await ensureGrantForState(sessionId, service, normalized, String(args.stateId))
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
        await ensureGrantForState(sessionId, service, normalized, String(args.stateId))
        const result = await service.waitFor(
          String(args.stateId),
          condition,
          typeof args.timeoutMs === 'number' ? args.timeoutMs : 5000,
        )
        return textReply(result)
      }
      default: {
        const _n: never = normalized
        throw new Error(`Unhandled tool: ${_n}`)
      }
    }
  } catch (err) {
    return errorReply(err)
  }
}
