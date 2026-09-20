import { COMPUTER_MEMORY_DISCOVERY_HINT, withMemoryDiscoveryHint } from '@superone/shared/interaction-memory'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z, toJSONSchema, type ZodTypeAny } from 'zod'
import {
  ComputerUseService,
  type ComputerUseServiceOptions,
} from './computer-use-service'
import { createComputerUseService } from './create-service'
import { ensureComputerUseAppGrant } from './grant-request'
import { ComputerUseError } from './types'
import { conditionSchema, parseCondition } from './conditions'
import { COMPUTER_RUN_DESCRIPTION, computerRunInputShape, executeComputerRun, rootForApp } from '../jev/computer-run-tool'
import { jevSettingError } from '../jev/run-tool-common'
import { COMPUTER_USE_TOOL_NAMES } from '@superone/shared/superone-host-owned-tools'
import type { SuperoneMcpToolDescriptor } from '../mcp/superone-mcp-types'
import { readAppSettings } from '../app-settings-service'
import { persistComputerUseScreenshot } from './screenshot-store'
import { releaseComputerUseViewfinder } from './viewfinder'
import type { CapturedImage } from './types'
import { encode as toonEncode } from '@toon-format/toon'
import { abandonActionRecording, createActionRecordingPath } from '../agent/action-recording-store'
import { publishArtifact } from '../environment/zone-delivery'
import { outlineToToon } from './outline-toon'
import { imageNote, recordingNote } from '../mcp/show-your-work-notes'

export { COMPUTER_USE_TOOL_NAMES }

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
  sessionId: string,
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
      { sessionId },
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
function withAgentImages<T extends { image?: CapturedImage }>(result: T, sessionId: string): T {
  if (!result.image) return result
  const image = toAgentImage(result.image, sessionId)
  return { ...result, image, ...(image?.path ? { imageNote: imageNote('image.path') } : {}) }
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
    'select',
    'open',
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
      + 'action=focus|launch accepts display name (any locale) or reverse-DNS bundleId; host resolves to a stable bundleId before the permission grant so one allow covers later snapshot/act. '
      + 'Launch/focus returns a slim {target} confirmation. If the user only asks to open an app, launch once and stop when target is returned. '
      + 'For navigation, forms or search, prefer computer_run when Jev is enabled; batch known button sequences with computer_act. '
      + 'Focus only raises the window and leaves the app in the background; pass activate=true only when the app must stay the active app for a sequence of foreground-only steps (menu bar commands and ⌘ shortcuts work in the background; no activation is needed for them).',
    shape: {
      ...descriptionField,
      action: z.enum(['list', 'focus', 'launch']).optional().describe('Default list'),
      app: z
        .string()
        .optional()
        .describe(
          'Display name (any locale) or reverse-DNS bundle id for focus/launch. Prefer bundleId from a prior list when known.',
        ),
      activate: z
        .boolean()
        .optional()
        .describe('focus only: make the app frontmost and keep it there. Leave unset so the user keeps their current app; menu bar commands do not need it.'),
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
      + 'The image is NOT loaded into your context automatically; call Read on image.path if you need to look at pixels, and embed image.path in your reply when it is evidence of the result (read_manual product/show-your-work). '
      + 'mode=semantic returns accessibility outline with @eN refs (no image). mode=fused = screenshot + AX. '
      + 'The outline is a TOON table, not JSON: a header row outline[N]{ref,depth,role,name,value,x,y,w,h,can,state}: '
      + 'followed by one CSV-style row per node, in depth-first reading order. '
      + 'depth is the nesting level (a row is a child of the nearest row above it with a smaller depth). '
      + 'can lists only the supported actions, pipe-joined (press|select|open|setText|typeText|scroll|focus); empty means the node is inert. '
      + 'state lists only non-default flags (disabled|focused). x,y,w,h are the frame in capture space, empty when the node reports none. '
      + 'truncation.nodesOmitted > 0 means the returned outline was folded — reach the rest with computer_query, do not recapture. '
      + 'truncation.sourceTruncated means the native accessibility walk itself hit a limit, so those nodes are missing from the full tree too and computer_query cannot reach them either — narrow the target with capture=window or a specific rootId instead. '
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
      + 'Use this for progressive disclosure of deep accessibility trees. '
      + 'expand/inspect return the subtree/element as the same TOON table computer_snapshot uses.',
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
      'Submit 1–20 related UI actions as a checked transaction against a stateId. Batch a known button sequence here; prefer computer_run when each next target must be found from new UI state and Jev is enabled. '
      + 'Set delivery explicitly when you can; that field describes how the three modes differ. '
      + 'Actions: click, typeText, keypress, scroll(dx,dy[,x,y|ref]), drag(path≥2 points), moveMouse, press/select/open/setText (AX). select chooses a selectable item; open invokes its observed native open action. typeText is keystrokes at the insertion point, subject to the app\'s own autocorrect and auto-capitalisation; setText sets a value exactly. '
      + 'scroll: positive dy scrolls content down; aim with x,y (capture space) or ref center; else window/outline center. '
      + 'drag: path is capture-space points; virtual cursor animates along the path. '
      + 'Returns outcome worked|didnt|unknown based on re-observation (not API success codes): '
      + 'worked when AX readback, expect, typed text, or a meaningful successor outline diff confirms effect; '
      + 'unknown only when applied but unprovable; didnt on hard failure or failed expect. '
      + 'When the successor has pixels, successorImage.path contains the fresh screenshot. '
      + 'Set recording=true to save a short video containing only this action transaction. '
      + 'Stale stateId (UI changed since snapshot) is rejected before side effects. '
      + 'delivery=semantic never silently upgrades to app-directed/physical input.',
    shape: {
      ...descriptionField,
      stateId: z.string(),
      actions: z.array(actionSchema).min(1).max(20),
      expect: conditionSchema.optional().describe('Postcondition checked after actions'),
      timeoutMs: z.number().int().min(100).max(60_000).optional()
        .describe('Maximum wait for expect before the action is judged. Default 5000.'),
      recording: z.boolean().optional().describe('Save a video of only this action transaction. Default false.'),
      delivery: z
        .enum(['semantic', 'app-directed', 'physical'])
        .optional()
        .describe(
          'semantic — pure AX; prefer it whenever actions use @eN refs and the action is press/select/open/setText/click(ref)/typeText(ref), the most reliable path for labeled controls. '
            + 'app-directed — the default when omitted; for coordinate click/type/scroll/drag/keypress or when no usable AX ref exists. Posts CGEvent to the target app PID in the background without stealing frontmost; a ⌘ shortcut (keys=["cmd+s"]) works there too, the app is made to believe it is active for it. System-wide hotkeys (⌘Space, ⌘Tab, screenshots) need physical. '
            + 'physical — global HID; only when app-directed fails. Requires frontmost and is disruptive.',
        ),
    },
  },
  { name: 'computer_run', description: COMPUTER_RUN_DESCRIPTION, shape: computerRunInputShape },
  {
    name: 'computer_wait_for',
    description:
      'Wait until a UI condition holds. Distinguishes preexisting (already true) from verified (became true); failed means the timeout ran out, and observed then carries what the element read as. '
      + 'Do not sleep+poll with snapshot yourself.',
    shape: {
      ...descriptionField,
      stateId: z.string(),
      condition: conditionSchema,
      timeoutMs: z.number().int().min(100).max(60_000).optional().describe('Default 5000'),
    },
  },
]

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
      async (args: Record<string, unknown>, extra) => {
        try {
          const parsed = schema.parse(args ?? {}) as Record<string, unknown>
          return await executeComputerUseTool(sessionId, def.name, parsed, {
            signal: extra.signal,
          })
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
      async (args: Record<string, unknown>, extra) => {
        try {
          const parsed = schema.parse(args ?? {}) as Record<string, unknown>
          return await executeComputerUseTool(sessionId, 'computer_snapshot', parsed, {
            signal: extra.signal,
          })
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
  signal?: AbortSignal
}

const defaultServices = new Map<string, ComputerUseService>()
const lifecycleTails = new Map<string, Promise<void>>()
const activityGenerations = new Map<string, number>()

function noteComputerUseActivity(sessionId: string): number {
  const generation = (activityGenerations.get(sessionId) ?? 0) + 1
  activityGenerations.set(sessionId, generation)
  return generation
}

function runInComputerUseLifecycle<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = lifecycleTails.get(sessionId) ?? Promise.resolve()
  const result = previous.catch(() => {}).then(task)
  const tail = result.then(() => {}, () => {})
  lifecycleTails.set(sessionId, tail)
  void tail.finally(() => {
    if (lifecycleTails.get(sessionId) === tail) lifecycleTails.delete(sessionId)
  })
  return result
}

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
  if (s) {
    try {
      s.reset()
    } catch {
      // ignore
    }
    defaultServices.delete(sessionId)
  }
  activityGenerations.delete(sessionId)
  lifecycleTails.delete(sessionId)
}

export function clearComputerUseServices(): void {
  for (const s of defaultServices.values()) s.reset()
  defaultServices.clear()
  activityGenerations.clear()
  lifecycleTails.clear()
  resetModuleGate()
}

/**
 * Hide software cursor + menu-bar control chip.
 * Call when the agent is no longer controlling: turn ended, interrupted, idle,
 * session disposed, or Computer Use disabled.
 *
 * @param sessionId When set, clear only that session. Calls are serialized with
 *   tool execution so an older turn cannot tear down a newer turn's visuals.
 */
export async function hideComputerUseVisuals(sessionId?: string): Promise<void> {
  // The viewfinder is a shared slot, so letting go of it is part of letting go of the
  // visuals — otherwise the device and browser previews go on standing aside for a
  // turn that ended.
  releaseComputerUseViewfinder(sessionId)
  if (sessionId) {
    const requestedGeneration = activityGenerations.get(sessionId) ?? 0
    await runInComputerUseLifecycle(sessionId, async () => {
      // A newer tool call was queued after this cleanup request. Leave its UI
      // and dedicated-display placement intact.
      if ((activityGenerations.get(sessionId) ?? 0) !== requestedGeneration) return
      const service = defaultServices.get(sessionId)
      if (service) {
        await service.clearVisuals()
        return
      }
      if (process.platform !== 'darwin') return
      try {
        const { getSharedHelperClient } = await import('./platform/macos-helper-client')
        await getSharedHelperClient().call('session_clear_visuals', { sessionId })
      } catch {
        // helper offline
      }
    })
    return
  }

  const sessionIds = [...defaultServices.keys()]
  if (sessionIds.length > 0) {
    await Promise.all(sessionIds.map((id) => hideComputerUseVisuals(id)))
    return
  }
  if (process.platform === 'darwin') {
    try {
      const { getSharedHelperClient } = await import('./platform/macos-helper-client')
      await getSharedHelperClient().call('session_clear_visuals')
    } catch {
      // helper offline
    }
  }
}

/** Feature gate — default off. Reads AppSettings.computerUseEnabled unless overridden in tests. */
let enabledOverride: boolean | null = null
let allowAllOverride: boolean | null = null

export function isComputerUseSupportedPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin'
}

export function isComputerUseEnabled(): boolean {
  if (enabledOverride !== null) return enabledOverride
  if (!isComputerUseSupportedPlatform()) return false
  try {
    return readAppSettings().computerUseEnabled === true
  } catch {
    return false
  }
}

export function isComputerUseAllowAllApps(): boolean {
  if (allowAllOverride !== null) return allowAllOverride
  if (!isComputerUseSupportedPlatform()) return false
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

async function executeComputerUseToolInner(
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
  context.signal?.throwIfAborted()
  if (normalized === 'computer_run') {
    if (!isComputerUseEnabled()) return errorReply(new Error('Computer Use is disabled. Enable it in Settings before calling computer_run.'))
    const gate = jevSettingError()
    if (gate) return errorReply(new Error(gate))
  }

  let service: ComputerUseService
  try {
    service = context.host?.getService(sessionId) ?? getOrCreateComputerUseService(sessionId)
  } catch (err) {
    return errorReply(err)
  }
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
          const result = await service.apps(action, identity.bundleId, { activate: args.activate === true })
          // Slim launch/focus payload — still TOON for consistency.
          return withMemoryDiscoveryHint(toonReply(result), COMPUTER_MEMORY_DISCOVERY_HINT)
        }
        const result = await service.apps('list', undefined, {
          query: typeof args.query === 'string' ? args.query : undefined,
          offset: typeof args.offset === 'number' ? args.offset : undefined,
          limit: typeof args.limit === 'number' ? args.limit : undefined,
          includeRoots: args.includeRoots === true,
        })
        return withMemoryDiscoveryHint(toonReply(result), COMPUTER_MEMORY_DISCOVERY_HINT)
      }
      case 'computer_run': {
        return textReply(await executeComputerRun(sessionId, args, service, async (target, signal) => {
          signal?.throwIfAborted()
          let root = target.root
          if (target.app) {
            const identity = await service.resolveAppIdentity(target.app)
            await ensureComputerUseAppGrant({ sessionId, service, ...identity, toolName: normalized })
            signal?.throwIfAborted()
            root = await rootForApp(service, identity.bundleId, signal)
          } else {
            await ensureGrantForRoot(sessionId, service, normalized, root)
          }
          signal?.throwIfAborted()
          return (await service.resolveTargetRoot(root)).rootId
        }, context.signal))
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
        const agentResult = withAgentImages(result, sessionId)
        // Persist path onto stored state so later UI can resolve the same file.
        if (agentResult.image?.path) {
          service.alignStateVisual(result.stateId, agentResult.image)
        }
        // Outline goes out as a TOON table, not nested JSON — see outline-toon.ts.
        // The envelope stays JSON so the chat UI keeps parsing stateId / bundleId.
        return withMemoryDiscoveryHint(textReply({ ...agentResult, outline: outlineToToon(agentResult.outline) }), COMPUTER_MEMORY_DISCOVERY_HINT)
      }
      case 'computer_zoom': {
        const region = args.region as [number, number, number, number]
        if (!Array.isArray(region) || region.length !== 4) {
          throw new ComputerUseError('INVALID_ACTION', 'region must be [x0,y0,x1,y1]')
        }
        await ensureGrantForState(sessionId, service, normalized, String(args.stateId))
        const result = await service.zoom(String(args.stateId), region)
        return textReply(withAgentImages(result, sessionId))
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
        return textReply({
          ...result,
          ...(result.subtree ? { subtree: outlineToToon(result.subtree) } : {}),
          ...(result.element ? { element: outlineToToon(result.element) } : {}),
        })
      }
      case 'computer_act': {
        await ensureGrantForState(sessionId, service, normalized, String(args.stateId))
        // Reserved before the action: the helper's recorder fills it for the
        // whole run. Every exit that does not hand back a sealed recording —
        // the action failing, the helper producing none — gives the path up.
        const recordingPath = args.recording === true ? createActionRecordingPath(sessionId, 'computer', 'mp4') : null
        let result: Awaited<ReturnType<typeof service.act>>
        try {
          result = await service.act(String(args.stateId), args.actions, {
            expect: parseCondition(args.expect),
            delivery: args.delivery as 'semantic' | 'app-directed' | 'physical' | undefined,
            timeoutMs: args.timeoutMs as number | undefined,
            signal: context.signal,
            ...(recordingPath ? { recordingPath } : {}),
          })
        } catch (error) {
          if (recordingPath) abandonActionRecording(sessionId, recordingPath)
          throw error
        }
        const successorImage = toAgentImage(result.successorImage, sessionId)
        if (successorImage?.path) {
          service.alignStateVisual(result.successorStateId, successorImage)
        }
        // The path was reserved before the action ran; it is an artifact only
        // once the helper has sealed the file, which is what `recording` in the
        // result means (session-sync-zone.md §3).
        const savedPath = (result as { recording?: { savedPath?: unknown } }).recording?.savedPath
        if (typeof savedPath === 'string' && savedPath) {
          publishArtifact(sessionId, { path: savedPath, producer: 'recording', final: true })
        } else if (recordingPath) {
          abandonActionRecording(sessionId, recordingPath)
        }
        return textReply({
          ...result,
          successorImage,
          ...(result.recording ? { recordingNote: recordingNote('recording.savedPath') } : {}),
        })
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
          context.signal,
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

export async function executeComputerUseTool(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  context: ComputerUseToolExecutionContext = {},
): Promise<ComputerUseToolReply> {
  noteComputerUseActivity(sessionId)
  return runInComputerUseLifecycle(
    sessionId,
    () => executeComputerUseToolInner(sessionId, toolName, args, context),
  )
}
