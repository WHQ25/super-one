import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z, toJSONSchema, type ZodTypeAny } from 'zod'
import { browserAutomationCall, type BrowserAutomationOp } from '../browser/browser-automation-bridge'
import { existsSync } from 'fs'
import { isCdpEnabled, isCdpCookiesEnabled, isCdpMockEnabled, isCdpEmulateEnabled, resolveCdpTarget, cdpScreenshot, cdpClick, cdpHover, cdpDrag, cdpPress, cdpType, cdpEmulate, cdpGetCookies, cdpSetFileInput } from '../browser/browser-cdp'
import { encode as toonEncode } from '@toon-format/toon'
import { startRecording, stopRecording, waitForRecordedRequest, getRecordedRequest, addMockRule, clearMockRules, type RecordedRequest } from '../browser/browser-cdp-network'
import { persistScreenshot } from '../agent/browser-screenshot-store'
import { raceDownloadTask, startUrlDownloadTask } from '../browser/browser-download-tasks'
import { listDownloads } from '../browser/browser-downloads'
import { persistTextArtifact } from '../agent/browser-artifact-store'
import type { SuperoneMcpToolDescriptor } from './superone-mcp-types'
import { registerBrowserActionTools } from './browser-action-mcp-tools'
import { ARTIFACT_PREVIEW_CHARS, INLINE_ARTIFACT_LIMIT, spillLargeBrowserField } from './browser-mcp-artifacts'
import {
  browserErrorReply as errorReply,
  browserTextReply as textReply,
  browserToonReply,
  type BrowserToolReply as ToolReply,
} from './browser-mcp-replies'

import { BROWSER_TOOL_NAMES } from './superone-mcp-builtin-defs'
export { BROWSER_TOOL_NAMES }

interface ScreenshotResult {
  mimeType: 'image/png'
  data: string
  width: number
  height: number
}

// Network tools return TOON instead of JSON: a recording's request manifest is a
// uniform array of flat rows, where TOON's tabular encoding (header once + CSV
// rows) is far cheaper than JSON's per-row repeated keys. TOON only wins on
// uniform/flat data — that is why the manifest is kept flat (see toManifest).
function toonReply(data: unknown): ToolReply {
  return browserToonReply(toonEncode, data)
}

async function dataTool(
  sessionId: string,
  op: BrowserAutomationOp,
  input: unknown,
  reply: (data: unknown) => ToolReply = textReply,
): Promise<ToolReply> {
  try {
    return reply(await browserAutomationCall(sessionId, op, input))
  } catch (err) {
    return errorReply(err)
  }
}

const REQUEST_BODY_CAP = 8192

// A stop/wait manifest row: a LEAN, UNIFORM set of scan fields (same keys on
// every row) so TOON encodes the array as a compact table. Headers, request
// payload, and the full response body are NOT here — read one request's full
// detail on demand with browser_network_body via `requestId`. Keeping every key
// present (null when absent) preserves the uniformity TOON's tabular form needs.
function toManifest(entry: RecordedRequest): Record<string, unknown> {
  return {
    requestId: entry.requestId,
    method: entry.method,
    status: entry.failed ? 'failed' : entry.status ?? null,
    resourceType: entry.resourceType ?? null,
    url: entry.url,
    bodyBytes: entry.body?.length ?? null,
  }
}

type AutomationEngine = 'auto' | 'cdp' | 'synthetic'

async function cdpOrData(
  sessionId: string,
  op: BrowserAutomationOp,
  input: unknown,
  cdpFn: () => Promise<unknown>,
  engine: AutomationEngine = 'auto',
): Promise<ToolReply> {
  try {
    if (engine === 'cdp' && !isCdpEnabled()) return errorReply(CDP_REQUIRED_MESSAGE)
    const useCdp = engine === 'cdp' || (engine === 'auto' && isCdpEnabled())
    if (useCdp) return textReply(await cdpFn())
    return textReply(await browserAutomationCall(sessionId, op, input))
  } catch (err) {
    return errorReply(err)
  }
}

interface ResolvePoint {
  ok: boolean
  webContentsId: number
  x: number
  y: number
  selector?: string
  name?: string
  ambiguous?: number
  error?: string
}

const CDP_REQUIRED_MESSAGE = 'This tool requires the browser CDP setting. Enable it in Settings → Browser.'

const VIEWPORT_PRESETS: Record<'mobile' | 'tablet' | 'desktop', { width: number; height: number }> = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
}

async function cdpTool(
  sessionId: string,
  tab: string | undefined,
  fn: (webContentsId: number) => Promise<unknown>,
  reply: (data: unknown) => ToolReply = textReply,
): Promise<ToolReply> {
  try {
    if (!isCdpEnabled()) return errorReply(CDP_REQUIRED_MESSAGE)
    const webContentsId = await resolveCdpTarget(sessionId, tab)
    return reply(await fn(webContentsId))
  } catch (err) {
    return errorReply(err)
  }
}

function assertExperimental(enabled: boolean, setting: string): void {
  if (!enabled) throw new Error(`The '${setting}' experimental browser tool is disabled. Enable it in Settings → Browser → Experimental tools.`)
}

const tabField = {
  tab: z
    .string()
    .optional()
    .describe('Browser view id. Omit to target the focused browser view (errors if multiple are open).'),
}

const descriptionField = {
  description: z
    .string()
    .optional()
    .describe(
      "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
    ),
}

type BrowserToolHandler = (args: Record<string, unknown>) => Promise<ToolReply>

interface CapturingServer {
  registerTool: (
    name: string,
    config: { description: string; inputSchema?: Record<string, ZodTypeAny> },
    handler: BrowserToolHandler,
  ) => unknown
}

const browserHandlerCache = new Map<string, Map<string, BrowserToolHandler>>()
let browserToolDescriptors: SuperoneMcpToolDescriptor[] | null = null

function zodShapeToJsonSchema(shape: Record<string, ZodTypeAny> | undefined): Record<string, unknown> {
  const schema = toJSONSchema(z.object(shape ?? {})) as Record<string, unknown>
  const { $schema: _schema, ...rest } = schema
  return rest
}

function captureBrowserTools(sessionId: string): {
  descriptors: SuperoneMcpToolDescriptor[]
  handlers: Map<string, BrowserToolHandler>
} {
  const descriptors: SuperoneMcpToolDescriptor[] = []
  const handlers = new Map<string, BrowserToolHandler>()
  const capturing: CapturingServer = {
    registerTool: (name, config, handler) => {
      const shape = config.inputSchema ?? {}
      const schema = z.object(shape)
      descriptors.push({
        name,
        description: config.description,
        inputSchema: zodShapeToJsonSchema(shape),
      })
      // Stdio path does not run the MCP SDK's Zod parse, so apply defaults here.
      handlers.set(name, async (args) => {
        try {
          return await handler(schema.parse(args ?? {}) as Record<string, unknown>)
        } catch (err) {
          return errorReply(err)
        }
      })
      return { remove: () => {} }
    },
  }
  registerBrowserTools(capturing as unknown as McpServer, sessionId)
  return { descriptors, handlers }
}

export function getBrowserToolDescriptors(): SuperoneMcpToolDescriptor[] {
  if (browserToolDescriptors) return browserToolDescriptors
  browserToolDescriptors = captureBrowserTools('__descriptor__').descriptors
  return browserToolDescriptors
}

export async function executeBrowserTool(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolReply> {
  let handlers = browserHandlerCache.get(sessionId)
  if (!handlers) {
    handlers = captureBrowserTools(sessionId).handlers
    browserHandlerCache.set(sessionId, handlers)
  }
  const handler = handlers.get(toolName)
  if (!handler) throw new Error(`Unknown browser tool: ${toolName}`)
  return handler(args)
}

export function clearBrowserToolHandlers(sessionId: string): void {
  browserHandlerCache.delete(sessionId)
}

export function isBrowserToolName(name: string): boolean {
  return (BROWSER_TOOL_NAMES as readonly string[]).includes(name)
}

export function registerBrowserTools(server: McpServer, sessionId: string): void {
  registerBrowserActionTools(server, sessionId, executeBrowserTool)

  server.registerTool(
    'browser_snapshot',
    {
      description:
        "Inspect the current browser page. Pick which data sections to return via `include`: 'meta' (url/title/loading), 'elements' (flat list of top interactive elements + CSS selectors + total count), 'tree' (hierarchical accessibility tree of landmarks/headings/interactive nodes — use when you need page STRUCTURE and nesting, not just a flat list), 'text' (truncated visible text), 'console' (recent console entries, filterable). Default include is ['meta','elements','console'] (lean, warning+error console only). Fetch just logs with include:['console'] — that skips the DOM scan entirely. Call this first to orient. The result is TOON, not JSON: arrays render as a header row `name[N]{col,col}:` followed by one indented CSV-style row per item.",
      inputSchema: {
        ...tabField,
        include: z
          .array(z.enum(['meta', 'elements', 'tree', 'text', 'console']))
          .default(['meta', 'elements', 'console'])
          .describe("Which data sections to return. Default ['meta','elements','console']."),
        filter: z
          .string()
          .optional()
          .describe("Elements section only: case-insensitive substring; only return interactive elements whose name or role contains it."),
        max: z.number().int().min(1).max(200).default(40).describe('Elements section only: max interactive elements, ranked by viewport proximity. Default 40.'),
        depth: z.number().int().min(1).max(30).default(12).describe('Tree section only: max nesting depth to descend. Default 12.'),
        treeMax: z.number().int().min(1).max(500).default(150).describe('Tree section only: max nodes to emit (overload budget). When hit, the tree is cut and treeTruncated:true is returned. Default 150.'),
        textMaxChars: z.number().int().min(0).max(20000).default(4000).describe('Text section only: truncate visible text to this many chars. Default 4000.'),
        console: z
          .object({
            level: z
              .array(z.enum(['log', 'info', 'warning', 'error']))
              .optional()
              .describe("Console levels to include. Default ['warning','error']. Pass all four for everything."),
            grep: z.string().optional().describe('Only return console entries whose text matches this pattern (substring by default).'),
            regex: z.boolean().default(false).describe('Treat grep as a JS regular expression instead of a substring. Default false.'),
            ignoreCase: z.boolean().default(true).describe('Case-insensitive grep. Default true.'),
            invert: z.boolean().default(false).describe('Keep only entries that do NOT match grep (like grep -v). Default false.'),
            max: z.number().int().min(1).max(200).default(50).describe('Return the most recent N matching entries. Default 50.'),
          })
          .optional()
          .describe("Console section filtering. Only consulted when `include` contains 'console'."),
      },
    },
    (args) => dataTool(sessionId, 'snapshot', args, toonReply),
  )

  server.registerTool(
    'browser_query',
    {
      description:
        'Find elements on the page by structured criteria. Combine role, text, css selector, and attribute matchers. Returns matching elements with reusable selectors plus the total match count, as TOON (matches render as a `matches[N]{...}:` table + rows). Use this instead of snapshot when you already know what you are looking for.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        role: z.string().optional().describe("Match ARIA role or tag name, e.g. 'button', 'textbox', 'link'."),
        text: z.string().optional().describe("Case-insensitive substring in the element's accessible name or text."),
        selector: z.string().optional().describe('CSS selector to match. Combine with role/text or use alone.'),
        attributes: z.record(z.string(), z.string()).optional().describe("Attribute equals matchers, e.g. { type: 'submit' }."),
        visible: z.boolean().default(true).describe('Only return visible elements. Default true.'),
        max: z.number().int().min(1).max(100).default(20),
        fields: z
          .array(z.enum(['text', 'html', 'attributes', 'value', 'box']))
          .optional()
          .describe('Extra per-match fields beyond the lean reference. Omit for the cheapest result.'),
      },
    },
    (args) => dataTool(sessionId, 'query', args, toonReply),
  )

  server.registerTool(
    'browser_inspect',
    {
      description:
        'Get detail on one element identified by a CSS selector (typically from a snapshot or query result). Choose which fields to return; "context" adds the ancestor chain, associated labels, and the enclosing form.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        selector: z.string().describe('CSS selector of the element to inspect.'),
        fields: z
          .array(z.enum(['text', 'html', 'attributes', 'value', 'box', 'styles', 'context']))
          .default(['text', 'attributes', 'box'])
          .describe('Which detail fields to return.'),
        maxChars: z.number().int().min(0).max(20000).default(4000).describe('Truncate text/html to this many characters.'),
      },
    },
    (args) => dataTool(sessionId, 'inspect', args),
  )

  server.registerTool(
    'browser_screenshot',
    {
      description:
        'Capture a PNG screenshot of the visible viewport (or one element when a selector is given), save it to disk, and return its file path plus width/height. Oversized files are JPEG-re-encoded (same dimensions) for cheaper Read. To capture content below the fold, scroll to it first (browser_scroll) and screenshot again. The image is NOT loaded into your context automatically — if you actually need to look at it, call Read on the returned path. Prefer the text tools (snapshot/query/inspect) first; use a screenshot when pixels matter or to leave a visual record for the user.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        selector: z.string().optional().describe('CSS selector to screenshot just that element. Omit for the visible viewport.'),
      },
    },
    async (args) => {
      try {
        if (isCdpEnabled() && args.selector) {
          const webContentsId = await resolveCdpTarget(sessionId, args.tab)
          const shot = await cdpScreenshot(webContentsId, { selector: args.selector })
          const path = persistScreenshot(shot.data, 'image/png')
          if (!path) return errorReply('Failed to save screenshot to disk.')
          return textReply({ path, width: shot.width, height: shot.height })
        }
        const result = (await browserAutomationCall(sessionId, 'screenshot', args)) as ScreenshotResult
        const path = persistScreenshot(result.data, result.mimeType)
        if (!path) return errorReply('Failed to save screenshot to disk.')
        return textReply({ path, width: result.width, height: result.height })
      } catch (err) {
        return errorReply(err)
      }
    },
  )

  server.registerTool(
    'browser_click',
    {
      description:
        'Click one element. Prefer selector with a CSS selector from snapshot/query. Alternatively pass text to click the first matching visible element, or x/y viewport coordinates. Provide exactly one targeting mode.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        selector: z.string().optional().describe('CSS selector of the element to click.'),
        text: z.string().optional().describe('Click the first visible element whose accessible name or text contains this substring.'),
        x: z.number().optional().describe('Viewport X coordinate in CSS pixels. Must be paired with y.'),
        y: z.number().optional().describe('Viewport Y coordinate in CSS pixels. Must be paired with x.'),
        engine: z
          .enum(['auto', 'cdp', 'synthetic'])
          .default('auto')
          .describe(
            "'auto' (default): trusted CDP click when the CDP setting is on, else synthetic. 'cdp': trusted click via the browser input pipeline — needed for pointer-event UIs (e.g. Radix), popups/window.open, file pickers, autoplay, canvas; errors if the CDP setting is off. 'synthetic': untrusted DOM mouse events only — fine for a plain button/link.",
          ),
      },
    },
    (args) =>
      cdpOrData(
        sessionId,
        'click',
        args,
        async () => {
          const point = (await browserAutomationCall(sessionId, 'resolvePoint', args)) as ResolvePoint
          if (!point.ok) throw new Error(point.error ?? 'click target not found')
          await cdpClick(point.webContentsId, point.x, point.y)
          return { ok: true, selector: point.selector, name: point.name, ...(point.ambiguous ? { ambiguous: point.ambiguous } : {}) }
        },
        args.engine,
      ),
  )

  server.registerTool(
    'browser_hover',
    {
      description:
        'Hover the pointer over one element without clicking. Reveals hover-triggered UI: dropdown/flyout menus, tooltips, and controls that only appear on mouseover. Prefer selector with a CSS selector from snapshot/query; alternatively pass text to match the first visible element, or x/y viewport coordinates. Provide exactly one targeting mode. After hovering, snapshot/query again to read whatever the hover revealed.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        selector: z.string().optional().describe('CSS selector of the element to hover.'),
        text: z.string().optional().describe('Hover the first visible element whose accessible name or text contains this substring.'),
        x: z.number().optional().describe('Viewport X coordinate in CSS pixels. Must be paired with y.'),
        y: z.number().optional().describe('Viewport Y coordinate in CSS pixels. Must be paired with x.'),
        engine: z
          .enum(['auto', 'cdp', 'synthetic'])
          .default('auto')
          .describe(
            "'auto' (default): trusted CDP mouse move when the CDP setting is on, else synthetic. 'cdp': trusted hover via the browser input pipeline — needed for menus/tooltips gated on real pointer events (e.g. Radix, native title tooltips); errors if the CDP setting is off. 'synthetic': untrusted DOM pointer/mouse events only (pointerover/mouseover/mouseenter/mousemove) — fine for CSS :hover and most JS handlers.",
          ),
      },
    },
    (args) => {
      const modes = Number(args.selector != null) + Number(args.text != null) + Number(args.x != null && args.y != null)
      if (modes !== 1) return Promise.resolve(errorReply('Provide exactly one of selector, text, or x+y.'))
      return cdpOrData(
        sessionId,
        'hover',
        args,
        async () => {
          const point = (await browserAutomationCall(sessionId, 'resolvePoint', args)) as ResolvePoint
          if (!point.ok) throw new Error(point.error ?? 'hover target not found')
          await cdpHover(point.webContentsId, point.x, point.y)
          return { ok: true, selector: point.selector, name: point.name, ...(point.ambiguous ? { ambiguous: point.ambiguous } : {}) }
        },
        args.engine,
      )
    },
  )

  server.registerTool(
    'browser_type',
    {
      description:
        'Type text into an input. Prefer selector with a CSS selector; if omitted, types into the currently focused element. Set clear=true to replace existing text. Dispatches native input/change events so framework-controlled inputs update.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        text: z.string().describe('Literal text to insert.'),
        selector: z.string().optional().describe('CSS selector of the input. Omit to type into the focused element.'),
        clear: z.boolean().default(false).describe('Clear the existing value before typing. Default false.'),
        engine: z
          .enum(['synthetic', 'cdp'])
          .default('synthetic')
          .describe(
            "'synthetic' (default): sets the value natively and fires input/change — enough for ordinary framework-controlled inputs. 'cdp': trusted insert via the browser editing pipeline — use for rich editors (Monaco, CodeMirror, ProseMirror), masked/per-keystroke inputs, or logic gated on trusted events; requires the CDP setting. Neither engine emits per-character keydown.",
          ),
      },
    },
    (args) =>
      cdpOrData(
        sessionId,
        'type',
        args,
        async () => {
          const webContentsId = await resolveCdpTarget(sessionId, args.tab)
          // No focusView: host <webview>.focus() steals the user's composer focus
          // across sessions. CDP type uses guest debugger + focus emulation.
          await cdpType(webContentsId, args.text, args.selector, args.clear)
          return { ok: true, selector: args.selector }
        },
        args.engine,
      ),
  )

  server.registerTool(
    'browser_navigate',
    {
      description:
        'Change the page the browser shows. Provide exactly one of: url (a website), port (a local dev-server on localhost), or action (back/forward/reload to move through history). Waits for the page to stop loading by default.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        url: z.string().optional().describe("Website URL, e.g. https://example.com. A schemeless host like 'example.com' gets https; loopback gets http."),
        port: z.number().int().min(1).max(65535).optional().describe('Local dev-server port on localhost.'),
        path: z.string().optional().describe("Optional path/query for the port form, e.g. '/settings'."),
        protocol: z.enum(['http', 'https']).optional().describe("Protocol for the port form. Defaults to http."),
        action: z.enum(['back', 'forward', 'reload']).optional().describe('Move through history instead of loading a URL.'),
        readiness: z.enum(['load', 'none']).default('load').describe("'load' waits for loading to stop (default); 'none' returns immediately."),
      },
    },
    (args) => {
      const modes = Number(args.url != null) + Number(args.port != null) + Number(args.action != null)
      if (modes !== 1) {
        return Promise.resolve(errorReply('Provide exactly one of url, port, or action.'))
      }
      return dataTool(sessionId, 'navigate', args)
    },
  )

  server.registerTool(
    'browser_wait_for',
    {
      description:
        'Block until the page reaches a desired state, then return. Provide at least one condition; all are AND-combined: a css selector that must be visible, a selector that must be gone (e.g. a loading spinner), a visible-text substring, and/or a URL substring. Use after click/type/navigate when the page changes asynchronously. Defaults to 15s, max 60s.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        selector: z.string().optional().describe('CSS selector that must be present and visible.'),
        selectorGone: z.string().optional().describe('CSS selector that must be absent or hidden (e.g. a spinner that should disappear).'),
        text: z.string().optional().describe('Substring that must appear in visible document text.'),
        urlIncludes: z.string().optional().describe('Substring that must appear in the current URL.'),
        timeoutMs: z.number().int().min(100).max(60000).default(15000).describe('Maximum wait in milliseconds. Default 15000, max 60000.'),
      },
    },
    (args) => {
      if (args.selector == null && args.selectorGone == null && args.text == null && args.urlIncludes == null) {
        return Promise.resolve(errorReply('Provide at least one wait condition (selector, selectorGone, text, or urlIncludes).'))
      }
      return dataTool(sessionId, 'wait_for', args)
    },
  )

  server.registerTool(
    'browser_press',
    {
      description:
        "Press one keyboard key, e.g. { key: 'Enter' }, { key: 'Escape' }, or { key: 'a', modifiers: ['Meta'] }. Targets the element at selector, or the focused element if omitted. Enter submits the enclosing form when no modifiers are held.",
      inputSchema: {
        ...tabField,
        ...descriptionField,
        key: z.string().min(1).describe("Key name such as Enter, Escape, Tab, ArrowDown, Backspace, or a single character."),
        modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).optional().describe('Modifier keys held while pressing.'),
        selector: z.string().optional().describe('CSS selector of the key target. Omit to target the focused element.'),
        engine: z
          .enum(['synthetic', 'cdp'])
          .default('synthetic')
          .describe(
            "'synthetic' (default): a DOM KeyboardEvent — enough for JS key handlers (shortcuts, Enter-to-submit, Escape) but untrusted, no native browser behavior. 'cdp': trusted key via the browser input pipeline — use when a key must move focus (Tab), type into a native input, trigger a browser shortcut, or when a synthetic press had no effect; requires the CDP setting.",
          ),
      },
    },
    (args) =>
      cdpOrData(
        sessionId,
        'press',
        args,
        async () => {
          const webContentsId = await resolveCdpTarget(sessionId, args.tab)
          // No focusView — see browser_type CDP path. Host focus isolation is
          // also enforced in the renderer around every automation call.
          await cdpPress(webContentsId, args.key, args.modifiers, args.selector)
          return { ok: true, key: args.key }
        },
        args.engine,
      ),
  )

  server.registerTool(
    'browser_scroll',
    {
      description:
        'Scroll by CSS pixels. Positive deltaY scrolls down, positive deltaX scrolls right. Without a selector it scrolls the viewport; with one it scrolls that container. Provide at least one delta. Useful to trigger lazy-loading or reveal off-screen elements.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        deltaX: z.number().optional().describe('Horizontal scroll in CSS pixels. Positive scrolls right.'),
        deltaY: z.number().optional().describe('Vertical scroll in CSS pixels. Positive scrolls down.'),
        selector: z.string().optional().describe('CSS selector of a scrollable container. Omit to scroll the viewport.'),
      },
    },
    (args) => {
      if (args.deltaX == null && args.deltaY == null) {
        return Promise.resolve(errorReply('Provide deltaX or deltaY.'))
      }
      return dataTool(sessionId, 'scroll', args)
    },
  )

  const dragTarget = (role: string) =>
    z
      .object({
        selector: z.string().optional().describe('CSS selector of the element.'),
        text: z.string().optional().describe('Match the first visible element whose accessible name or text contains this substring.'),
        x: z.number().optional().describe('Viewport X coordinate in CSS pixels. Must be paired with y.'),
        y: z.number().optional().describe('Viewport Y coordinate in CSS pixels. Must be paired with x.'),
      })
      .describe(`Drag ${role}. Provide exactly one targeting mode: selector, text, or x+y.`)

  server.registerTool(
    'browser_drag',
    {
      description:
        'Drag from a source point to a destination point. Handles both pointer-driven gestures (sliders, sortable lists, canvas panning, drag-resize) and native HTML5 drag-and-drop (elements with draggable=true, e.g. kanban cards and file drop zones) — with the browser CDP setting on, it auto-detects which and drives trusted events for either. Target the source via `from` and the destination via `to`, each by selector, visible text, or x/y viewport coordinates. Tip: enable the browser CDP setting for reliable drags; without it, a best-effort synthetic fallback is used.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        from: dragTarget('source'),
        to: dragTarget('destination'),
        steps: z.number().int().min(1).max(50).default(10).describe('Number of intermediate move events between source and target. More steps = a slower, smoother drag (each step adds a small delay); fewer = a faster drag. Default 10.'),
        holdMs: z.number().int().min(0).max(10000).default(0).describe('Time in milliseconds to pause on the target after arriving, before releasing/dropping. Some drop zones only register the drop after a hover. Default 0.'),
        humanize: z.boolean().default(false).describe('When true, vary per-step timing and add positional jitter along an ease-in-out motion curve to mimic a human drag. Improves success on libraries that reject robotic linear moves. The final position is still exact. Default false.'),
      },
    },
    (args) => {
      const modes = (g: { selector?: string; text?: string; x?: number; y?: number }) =>
        Number(g.selector != null) + Number(g.text != null) + Number(g.x != null && g.y != null)
      if (modes(args.from) !== 1) return Promise.resolve(errorReply('Provide exactly one of selector, text, or x+y for `from`.'))
      if (modes(args.to) !== 1) return Promise.resolve(errorReply('Provide exactly one of selector, text, or x+y for `to`.'))
      return cdpOrData(sessionId, 'drag', args, async () => {
        const src = (await browserAutomationCall(sessionId, 'resolvePoint', { tab: args.tab, ...args.from })) as ResolvePoint
        if (!src.ok) throw new Error(src.error ?? 'drag source not found')
        const dst = (await browserAutomationCall(sessionId, 'resolvePoint', { tab: args.tab, ...args.to })) as ResolvePoint
        if (!dst.ok) throw new Error(dst.error ?? 'drag target not found')
        await cdpDrag(src.webContentsId, src.x, src.y, dst.x, dst.y, { steps: args.steps, holdMs: args.holdMs, humanize: args.humanize })
        return { ok: true, from: { selector: src.selector, name: src.name }, to: { selector: dst.selector, name: dst.name } }
      })
    },
  )

  server.registerTool(
    'browser_select',
    {
      description:
        'Set the value of a <select> dropdown (by value, visible label, or index) or toggle a checkbox/radio (by checked). Provide the selector plus exactly one of value, label, index, or checked. Dispatches native change events.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        selector: z.string().describe('CSS selector of the <select>, checkbox, or radio.'),
        value: z.string().optional().describe('Option value to select (for <select>).'),
        label: z.string().optional().describe('Visible option text to select (for <select>); exact match preferred, falls back to substring.'),
        index: z.number().int().min(0).optional().describe('Zero-based option index (for <select>).'),
        checked: z.boolean().optional().describe('Desired checked state (for checkbox/radio). Defaults to true.'),
      },
    },
    (args) => dataTool(sessionId, 'select', args),
  )

  server.registerTool(
    'browser_open',
    {
      description:
        'Open a new browser tab (optionally at a URL) and return its tab id. Use this when no browser is open yet, or to start a fresh page. Pass the returned tab id as the "tab" argument to the other browser tools. Waits for the page to stop loading by default.',
      inputSchema: {
        ...descriptionField,
        url: z.string().optional().describe("Initial URL. A schemeless host like 'example.com' gets https; loopback gets http. Defaults to a blank tab."),
        tab: z.string().optional().describe('Existing browser tab id to reuse/focus instead of creating a new one.'),
        readiness: z.enum(['load', 'none']).default('load').describe("'load' waits for loading to stop (default); 'none' returns as soon as the tab exists."),
      },
    },
    (args) => dataTool(sessionId, 'open', args),
  )

  server.registerTool(
    'browser_evaluate',
    {
      description:
        'Evaluate a JavaScript expression in the page and return its serializable result. Prefer snapshot and the semantic action tools; use evaluate only for inspection or interactions those tools cannot express. The expression runs in the page and may mutate its state. A returned Promise is awaited. A large result (>32KB serialized) is written to a temp file and returned as { spilled:true, path, bytes, preview } — Read/grep the path for the full value instead of it flooding context.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        expression: z.string().min(1).max(64000).describe('JavaScript expression, e.g. document.title or (() => ({ items: [...document.querySelectorAll("li")].map(li => li.textContent) }))().'),
      },
    },
    async (args) => {
      try {
        const res = (await browserAutomationCall(sessionId, 'evaluate', args)) as { value: unknown }
        const json = JSON.stringify(res.value ?? null)
        if (json.length <= INLINE_ARTIFACT_LIMIT) return textReply({ value: res.value ?? null })
        const path = persistTextArtifact(json, 'json')
        if (!path) return textReply({ value: res.value ?? null, bytes: json.length })
        return textReply({ spilled: true, path, bytes: json.length, preview: json.slice(0, ARTIFACT_PREVIEW_CHARS) })
      } catch (err) {
        return errorReply(err)
      }
    },
  )

  server.registerTool(
    'browser_tabs',
    {
      description:
        'List the browser tabs available to this session, each with its tab id, url, title, and loading state (result in TOON: a `tabs[N]{...}:` table). Use the returned tab id as the "tab" argument to target a specific tab. Only tabs belonging to this session are listed.',
      inputSchema: {},
    },
    () => dataTool(sessionId, 'tabs', {}, toonReply),
  )

  server.registerTool(
    'browser_resize',
    {
      description:
        "Resize the browser viewport to test responsive layouts — no CDP setting required. Pass a preset ('mobile' 375×812, 'tablet' 768×1024, 'desktop' 1280×800) or explicit width/height (CSS pixels). Pass reset:true to restore the panel's natural size. Only responsive pages (with a width=device-width viewport meta) reflow; non-responsive pages keep their wide layout. For device-pixel-ratio, touch emulation, user-agent, color scheme, timezone, or geolocation, use browser_emulate instead (it requires the CDP setting).",
      inputSchema: {
        ...tabField,
        ...descriptionField,
        preset: z.enum(['mobile', 'tablet', 'desktop']).optional().describe('Named viewport size: mobile 375×812, tablet 768×1024, desktop 1280×800.'),
        width: z.number().int().min(1).max(10000).optional().describe('Explicit viewport width in CSS pixels (pair with height). Overrides preset.'),
        height: z.number().int().min(1).max(10000).optional().describe('Explicit viewport height in CSS pixels (pair with width). Overrides preset.'),
        reset: z.boolean().optional().describe("Restore the panel's natural size, clearing any resize."),
      },
    },
    (args) => {
      if (args.reset) return dataTool(sessionId, 'emulateViewport', { tab: args.tab, reset: true })
      const preset = args.preset ? VIEWPORT_PRESETS[args.preset] : undefined
      const width = args.width ?? preset?.width
      const height = args.height ?? preset?.height
      if (width == null || height == null) {
        return Promise.resolve(errorReply('Provide a preset, both width and height, or reset:true.'))
      }
      return dataTool(sessionId, 'emulateViewport', { tab: args.tab, width, height })
    },
  )

  server.registerTool(
    'browser_network_start',
    {
      description:
        "Start recording network requests on a tab (requires the browser CDP setting). Nothing is captured until you start, and capture is torn down with zero overhead when you stop — so record only around the action you care about. Response bodies of matching requests are captured EAGERLY, so they are always readable later (never lost to the browser's cache eviction). Typical flow: browser_network_start → do an action (browser_click / browser_navigate) → browser_network_stop to collect exactly what that action triggered. Scope with `match` + `resourceTypes` to keep it lean.",
      inputSchema: {
        ...tabField,
        ...descriptionField,
        match: z.string().optional().describe('Only record requests whose URL contains this substring. Omit to record everything (within resourceTypes).'),
        resourceTypes: z
          .array(z.string())
          .optional()
          .describe("Resource types to record, case-insensitive: XHR, Fetch, Document, Script, Image, Stylesheet, Font, Media, WebSocket. Default ['XHR','Fetch'] (the app's own API calls). Pass ['*'] for all types."),
        captureBodies: z.boolean().default(true).describe('Capture response bodies of matching requests. Default true. Set false to record only metadata + headers (cheaper).'),
        max: z.number().int().min(1).max(1000).default(200).describe('Max requests to record before ignoring further ones. Default 200.'),
      },
    },
    (args) =>
      cdpTool(
        sessionId,
        args.tab,
        async (webContentsId) => {
          const recordingId = await startRecording(webContentsId, {
            match: args.match,
            resourceTypes: args.resourceTypes,
            captureBodies: args.captureBodies,
            max: args.max,
          })
          return { recordingId, capturing: true, match: args.match ?? null }
        },
        toonReply,
      ),
  )

  server.registerTool(
    'browser_network_stop',
    {
      description:
        'Stop a recording started with browser_network_start and return a lean manifest of what it captured, as TOON (a compact tabular format — read the rows top-to-bottom). Each row has requestId, method, status, resourceType, url, and bodyBytes — enough to scan and pick which requests matter. It deliberately does NOT include headers, the request payload, or the response body: read one request\'s full detail (headers + payload + response body) on demand with browser_network_body({ recordingId, requestId }), so a many-request recording never floods context. Bodies stay readable after stop (recent recordings are retained). Pass keep:true to read the manifest so far WITHOUT stopping (peek during a long-running action).',
      inputSchema: {
        recordingId: z.string().describe('The id returned by browser_network_start.'),
        keep: z.boolean().default(false).describe('Keep recording (peek) instead of stopping. Default false: stop and tear down capture.'),
      },
    },
    async (args) => {
      try {
        const requests = await stopRecording(args.recordingId, args.keep)
        if (requests == null) return errorReply(`No active recording with id: ${args.recordingId}`)
        return toonReply({ count: requests.length, requests: requests.map(toManifest) })
      } catch (err) {
        return errorReply(err)
      }
    },
  )

  server.registerTool(
    'browser_network_wait',
    {
      description:
        'Within an active recording, block until a recorded request whose URL contains the given substring finishes, then return its manifest row as TOON (requestId, method, status, resourceType, url, bodyBytes; read the full detail/body with browser_network_body via requestId). Use after an action that fires an async XHR/fetch, before browser_network_stop, instead of guessing a delay. Default timeout 15s, max 60s.',
      inputSchema: {
        ...descriptionField,
        recordingId: z.string().describe('The id returned by browser_network_start.'),
        url: z.string().min(1).describe('Substring the request URL must contain.'),
        timeoutMs: z.number().int().min(100).max(60000).default(15000).describe('Maximum wait in milliseconds. Default 15000.'),
      },
    },
    async (args) => {
      try {
        const hit = await waitForRecordedRequest(args.recordingId, args.url, args.timeoutMs)
        if (!hit) return errorReply(`Timed out after ${args.timeoutMs}ms waiting for a request matching "${args.url}" (or recording ${args.recordingId} was not found).`)
        return toonReply(toManifest(hit))
      } catch (err) {
        return errorReply(err)
      }
    },
  )

  server.registerTool(
    'browser_network_body',
    {
      description:
        "Read one recorded request's full detail on demand (result in TOON), by the requestId from a browser_network_stop / browser_network_wait manifest: method, url, status, mimeType, requestHeaders, requestBody (POST payload), responseHeaders, and the full response body. Reads from the recording's own captured store (not the browser's volatile cache), so it works even for large bodies long after the request finished. A large response body is written to a temp file and returned as { spilled:true, path, bytes, preview } — Read/grep the path. Works while the recording is active or after it has stopped (recent recordings are retained).",
      inputSchema: {
        ...descriptionField,
        recordingId: z.string().describe('The id returned by browser_network_start.'),
        requestId: z.string().describe('The requestId of the entry (from the stop/wait manifest) whose detail to read.'),
      },
    },
    (args) => {
      const e = getRecordedRequest(args.recordingId, args.requestId)
      if (!e) return Promise.resolve(errorReply(`No recorded request ${args.requestId} in recording ${args.recordingId} (it may have been evicted — recent recordings are retained).`))
      const detail: Record<string, unknown> = {
        url: e.url,
        method: e.method,
        status: e.failed ? 'failed' : e.status ?? null,
        statusText: e.statusText ?? null,
        mimeType: e.mimeType ?? null,
        requestHeaders: e.requestHeaders ?? null,
        requestBody: e.requestBody != null && e.requestBody.length > REQUEST_BODY_CAP ? e.requestBody.slice(0, REQUEST_BODY_CAP) : e.requestBody ?? null,
        responseHeaders: e.responseHeaders ?? null,
      }
      if (e.errorText) detail.errorText = e.errorText
      if (e.body == null) {
        detail.body = null
        detail.bodyOmitted = e.bodyOmitted ?? 'not-captured'
        return Promise.resolve(toonReply(detail))
      }
      return Promise.resolve(toonReply(spillLargeBrowserField({ ...detail, body: e.body, bodyTruncated: e.bodyTruncated }, 'body', 'txt')))
    },
  )

  server.registerTool(
    'browser_cookies',
    {
      description:
        'Read the cookies visible to the page (experimental; requires the browser CDP setting + cookie-access sub-setting). Returns name, value, domain, path, and key flags as TOON (a `cookies[N]{...}:` table). Long cookie values are truncated (a valueLength field carries the original length). Pass urls to scope to specific URLs.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        urls: z.array(z.string()).optional().describe('Only return cookies that would be sent to these URLs. Omit for the current page.'),
      },
    },
    (args) =>
      cdpTool(
        sessionId,
        args.tab,
        async (webContentsId) => {
          assertExperimental(isCdpCookiesEnabled(), 'cookie access')
          return { cookies: await cdpGetCookies(webContentsId, args.urls) }
        },
        toonReply,
      ),
  )

  server.registerTool(
    'browser_upload_file',
    {
      description:
        'Set the files on a file <input> element (requires the browser CDP setting). This is the only way to attach files to an upload control, which cannot be driven by synthetic events. Provide the input selector and absolute file paths.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        selector: z.string().describe("CSS selector of the file <input> element (input[type=file])."),
        files: z.array(z.string()).min(1).describe('Absolute paths of the files to attach.'),
      },
    },
    (args) =>
      cdpTool(sessionId, args.tab, async (webContentsId) => {
        const missing = args.files.filter((f) => !existsSync(f))
        if (missing.length) throw new Error(`File(s) not found: ${missing.join(', ')}`)
        await cdpSetFileInput(webContentsId, args.selector, args.files)
        return { ok: true, files: args.files.length }
      }),
  )

  server.registerTool(
    'browser_download',
    {
      description:
        "Fetch a file by URL and save it to disk through the browser session (cookies/auth apply, no CORS; data: URLs ok). Completes synchronously if finished within `timeoutMs`; otherwise continues in the background and returns status 'background' with a taskId — you will receive a task notification when it finishes. For downloads the page starts itself (export buttons, attachment links), click first then use browser_list_downloads. Files land in a temp dir — Read the path, or copy/move if the user wants it kept.",
      inputSchema: {
        ...descriptionField,
        url: z.string().min(1).describe('Absolute URL (or data: URL) of the file to download.'),
        filename: z
          .string()
          .optional()
          .describe("Override the saved file name. Defaults to Content-Disposition or the URL path segment."),
        timeoutMs: z
          .number()
          .int()
          .min(100)
          .max(120000)
          .default(15000)
          .describe('How long to wait for a synchronous result before moving the job to the background. Default 15000.'),
      },
    },
    async (args) => {
      try {
        const snap = startUrlDownloadTask(sessionId, args.url, args.filename)
        const raced = await raceDownloadTask(snap.taskId, args.timeoutMs)
        if (raced.mode === 'background') {
          return textReply({
            status: 'background',
            taskId: raced.task.taskId,
            url: raced.task.url,
            message:
              `Download still running after ${args.timeoutMs}ms; moved to background as task ${raced.task.taskId}. ` +
              'You will receive a task notification when it finishes. Continue other work in the meantime.',
          })
        }
        if (!raced.settled.ok) return errorReply(raced.settled.error)
        return textReply({ status: 'completed', taskId: snap.taskId, ...raced.settled.result })
      } catch (err) {
        return errorReply(err)
      }
    },
  )

  server.registerTool(
    'browser_list_downloads',
    {
      description:
        'List files the page triggered for download in this session (export buttons, Content-Disposition links, etc.). Captures are saved automatically without a save dialog. Newest first. Use after browser_click on a download control. Set wait:true to block until at least one matching capture is terminal and nothing is still progressing (or until timeout). Filter with state. This is observation only — to fetch a known URL use browser_download.',
      inputSchema: {
        ...descriptionField,
        state: z
          .enum(['all', 'progressing', 'completed', 'failed'])
          .default('all')
          .describe("Which captures to include. 'failed' = cancelled or interrupted. Default all."),
        wait: z
          .boolean()
          .default(false)
          .describe('If true, wait for captures to settle (see timeoutMs). Default false (immediate snapshot).'),
        timeoutMs: z
          .number()
          .int()
          .min(0)
          .max(120000)
          .default(15000)
          .describe('Max wait when wait is true. Default 15000. Ignored when wait is false.'),
      },
    },
    async (args) => {
      try {
        const downloads = await listDownloads(sessionId, {
          state: args.state,
          wait: args.wait,
          timeoutMs: args.timeoutMs,
        })
        return textReply({ count: downloads.length, downloads })
      } catch (err) {
        return errorReply(err)
      }
    },
  )

  server.registerTool(
    'browser_emulate',
    {
      description:
        'Emulate device and environment conditions for the page (experimental; requires the browser CDP setting + device-emulation sub-setting): viewport size, device scale, mobile mode, user agent, color scheme, timezone, locale, and geolocation. Pass reset:true to clear all overrides; they persist until reset or the tab is closed. width/height reflow only responsive pages (with a width=device-width viewport meta); non-responsive pages keep their wide layout.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        width: z.number().int().min(1).optional().describe('Viewport width in CSS pixels (pair with height).'),
        height: z.number().int().min(1).optional().describe('Viewport height in CSS pixels (pair with width).'),
        deviceScaleFactor: z.number().min(0).optional().describe('Device pixel ratio. 0 keeps the default.'),
        mobile: z.boolean().optional().describe('Emulate a mobile device (touch, mobile viewport).'),
        userAgent: z.string().optional().describe('Override the User-Agent header.'),
        colorScheme: z.enum(['light', 'dark', 'no-preference']).optional().describe('Emulate prefers-color-scheme.'),
        timezone: z.string().optional().describe("IANA timezone id, e.g. 'America/New_York'."),
        locale: z.string().optional().describe("Locale, e.g. 'en-US' or 'ja-JP'."),
        latitude: z.number().optional().describe('Geolocation latitude (pair with longitude).'),
        longitude: z.number().optional().describe('Geolocation longitude (pair with latitude).'),
        reset: z.boolean().optional().describe('Clear all emulation overrides.'),
      },
    },
    (args) =>
      cdpTool(sessionId, args.tab, async (webContentsId) => {
        assertExperimental(isCdpEmulateEnabled(), 'device emulation')
        await cdpEmulate(webContentsId, args)
        if (args.reset || (args.width != null && args.height != null)) {
          await browserAutomationCall(sessionId, 'emulateViewport', {
            tab: args.tab,
            reset: args.reset === true,
            width: args.width,
            height: args.height,
          }).catch(() => {})
        }
        return { ok: true, reset: args.reset === true }
      }),
  )

  server.registerTool(
    'browser_mock',
    {
      description:
        'Intercept matching network requests and respond with a mocked response (experimental; requires the browser CDP setting + network-mocking sub-setting). Provide a url substring to match and the response to return. Pass clear:true to remove all mocks. WARNING: this can read and alter all page traffic — use only in trusted scenarios.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        url: z.string().optional().describe('Substring; requests whose URL contains it are fulfilled with the mock. Required unless clear is set.'),
        status: z.number().int().min(100).max(599).optional().describe('HTTP status code to return (default 200).'),
        body: z.string().optional().describe('Response body to return (default empty).'),
        contentType: z.string().optional().describe("Response Content-Type (default 'application/json')."),
        headers: z.record(z.string(), z.string()).optional().describe('Extra response headers.'),
        clear: z.boolean().optional().describe('Remove all mock rules for this tab and stop intercepting.'),
      },
    },
    (args) =>
      cdpTool(sessionId, args.tab, async (webContentsId) => {
        assertExperimental(isCdpMockEnabled(), 'network mocking')
        if (args.clear) {
          await clearMockRules(webContentsId)
          return { ok: true, cleared: true }
        }
        if (!args.url) throw new Error('Provide a url to mock, or clear:true to remove mocks.')
        await addMockRule(webContentsId, {
          urlPattern: args.url,
          status: args.status ?? 200,
          body: args.body ?? '',
          contentType: args.contentType ?? 'application/json',
          headers: args.headers,
        })
        return { ok: true, mocking: args.url }
      }),
  )
}
