import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { browserAutomationCall, type BrowserAutomationOp } from '../browser/browser-automation-bridge'
import { existsSync } from 'fs'
import { isCdpEnabled, isCdpNetworkEnabled, isCdpCookiesEnabled, isCdpMockEnabled, isCdpEmulateEnabled, resolveCdpTarget, cdpScreenshot, cdpClick, cdpDrag, cdpPress, cdpType, cdpEmulate, cdpGetCookies, cdpSetFileInput } from '../browser/browser-cdp'
import { enableNetworkCapture, readNetwork, waitForRequest, getResponseBody, addMockRule, clearMockRules } from '../browser/browser-cdp-network'
import { persistScreenshot } from '../agent/browser-screenshot-store'

export const BROWSER_TOOL_NAMES = [
  'browser_snapshot',
  'browser_query',
  'browser_inspect',
  'browser_screenshot',
  'browser_click',
  'browser_type',
  'browser_navigate',
  'browser_wait_for',
  'browser_press',
  'browser_scroll',
  'browser_drag',
  'browser_select',
  'browser_open',
  'browser_evaluate',
  'browser_tabs',
  'browser_network',
  'browser_cookies',
  'browser_upload_file',
  'browser_emulate',
  'browser_mock',
] as const

interface ScreenshotResult {
  mimeType: 'image/png'
  data: string
  width: number
  height: number
}

type ToolReply = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >
  isError?: boolean
}

function textReply(data: unknown): ToolReply {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
}

function errorReply(err: unknown): ToolReply {
  return {
    content: [{ type: 'text', text: `[Error] ${err instanceof Error ? err.message : String(err)}` }],
    isError: true,
  }
}

async function dataTool(sessionId: string, op: BrowserAutomationOp, input: unknown): Promise<ToolReply> {
  try {
    return textReply(await browserAutomationCall(sessionId, op, input))
  } catch (err) {
    return errorReply(err)
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
  error?: string
}

const CDP_REQUIRED_MESSAGE = 'This tool requires the browser CDP setting. Enable it in Settings → Browser.'

async function cdpTool(sessionId: string, tab: string | undefined, fn: (webContentsId: number) => Promise<unknown>): Promise<ToolReply> {
  try {
    if (!isCdpEnabled()) return errorReply(CDP_REQUIRED_MESSAGE)
    const webContentsId = await resolveCdpTarget(sessionId, tab)
    return textReply(await fn(webContentsId))
  } catch (err) {
    return errorReply(err)
  }
}

function assertExperimental(enabled: boolean): void {
  if (!enabled) throw new Error('This experimental browser tool is disabled. Enable it in Settings → Browser → Experimental tools.')
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

export function registerBrowserTools(server: McpServer, sessionId: string): void {
  server.registerTool(
    'browser_snapshot',
    {
      description:
        "Inspect the current browser page. Pick which data sections to return via `include`: 'meta' (url/title/loading), 'elements' (top interactive elements + CSS selectors + total count), 'text' (truncated visible text), 'console' (recent console entries, filterable). Default include is ['meta','elements','console'] (lean, warning+error console only). Fetch just logs with include:['console'] — that skips the DOM scan entirely. Call this first to orient.",
      inputSchema: {
        ...tabField,
        include: z
          .array(z.enum(['meta', 'elements', 'text', 'console']))
          .default(['meta', 'elements', 'console'])
          .describe("Which data sections to return. Default ['meta','elements','console']."),
        filter: z
          .string()
          .optional()
          .describe("Elements section only: case-insensitive substring; only return interactive elements whose name or role contains it."),
        max: z.number().int().min(1).max(200).default(40).describe('Elements section only: max interactive elements, ranked by viewport proximity. Default 40.'),
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
    (args) => dataTool(sessionId, 'snapshot', args),
  )

  server.registerTool(
    'browser_query',
    {
      description:
        'Find elements on the page by structured criteria. Combine role, text, css selector, and attribute matchers. Returns matching elements with reusable selectors plus the total match count. Use this instead of snapshot when you already know what you are looking for.',
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
    (args) => dataTool(sessionId, 'query', args),
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
        'Capture a PNG screenshot of the visible viewport (or one element when a selector is given), save it to disk, and return its file path plus width/height. To capture content below the fold, scroll to it first (browser_scroll) and screenshot again. The image is NOT loaded into your context automatically — if you actually need to look at it, call Read on the returned path. Prefer the text tools (snapshot/query/inspect) first; use a screenshot when pixels matter or to leave a visual record for the user.',
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
            "Input engine. 'auto' (default): a real trusted mouse click via CDP when that setting is on, else synthetic. 'cdp': real trusted click through the browser input pipeline — the reliable default; needed for pointer-event UIs (e.g. Radix), popups/window.open, native file pickers, media autoplay, and canvas. 'synthetic': lightweight DOM mouse events (mousedown/mouseup/click only, no pointer events, untrusted) — faster, but drop it down to this only for a plain button/link when you want to skip CDP overhead and don't need user-activation. Errors if 'cdp' is requested while the CDP setting is off.",
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
          return { ok: true, selector: point.selector, name: point.name }
        },
        args.engine,
      ),
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
            "Input engine. 'synthetic' (default): sets the value via the native setter and fires input/change so framework-controlled inputs (React etc.) update — fast and enough for ordinary inputs and textareas. Switch to 'cdp' for a real trusted insert through the browser editing pipeline when targeting rich editors (Monaco, CodeMirror, ProseMirror), masked/auto-complete/max-length inputs that react per keystroke, or logic gated on trusted events. Note: neither engine emits per-character keydown. 'cdp' requires the CDP setting enabled in Settings → Browser.",
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
          await browserAutomationCall(sessionId, 'focusView', { tab: args.tab })
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
            "Input engine. 'synthetic' (default): a DOM KeyboardEvent — fast, focus-independent, and enough for pages that handle keys in JS (app shortcuts, Enter-to-submit, Escape). It is untrusted and does NOT drive native browser behaviors. Switch to 'cdp' for a real trusted key event through the browser input pipeline when a key must move focus (Tab), type into a native input, trigger a browser shortcut, or when a synthetic press had no visible effect (the page ignores untrusted events). 'cdp' requires the CDP setting enabled in Settings → Browser.",
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
          await browserAutomationCall(sessionId, 'focusView', { tab: args.tab })
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
        'Evaluate a JavaScript expression in the page and return its serializable result (up to 64KB). Prefer snapshot and the semantic action tools; use evaluate only for inspection or interactions those tools cannot express. The expression runs in the page and may mutate its state. A returned Promise is awaited.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        expression: z.string().min(1).max(64000).describe('JavaScript expression, e.g. document.title or (() => ({ items: [...document.querySelectorAll("li")].map(li => li.textContent) }))().'),
      },
    },
    (args) => dataTool(sessionId, 'evaluate', args),
  )

  server.registerTool(
    'browser_tabs',
    {
      description:
        'List the browser tabs available to this session, each with its tab id, url, title, and loading state. Use the returned tab id as the "tab" argument to target a specific tab. Only tabs belonging to this session are listed.',
      inputSchema: {},
    },
    () => dataTool(sessionId, 'tabs', {}),
  )

  if (isCdpNetworkEnabled()) server.registerTool(
    'browser_network',
    {
      description:
        'Inspect the network traffic of the page (requires the browser CDP setting). Lists recent requests with method, URL, status, resource type, and size. Filter by urlIncludes/method/status/resourceType. Long URLs are truncated in the listing. Pass waitForUrl to block until a matching request completes (e.g. after a click that triggers an XHR). Pass bodyForUrl to fetch the response body of the most recent matching request (up to 64KB).',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        urlIncludes: z.string().optional().describe('Only include requests whose URL contains this substring.'),
        method: z.string().optional().describe('Only include requests with this HTTP method (GET, POST, ...).'),
        statusMin: z.number().int().optional().describe('Minimum HTTP status code (inclusive).'),
        statusMax: z.number().int().optional().describe('Maximum HTTP status code (inclusive), e.g. statusMin 400 to find errors.'),
        resourceType: z.string().optional().describe('Only include this resource type (Document, XHR, Fetch, Script, Image, ...).'),
        failedOnly: z.boolean().optional().describe('Only include requests that failed.'),
        max: z.number().int().min(1).max(300).optional().describe('Maximum number of requests to return (default 50).'),
        waitForUrl: z.string().optional().describe('Block until a completed request whose URL contains this substring appears, then return it.'),
        timeoutMs: z.number().int().min(100).max(60000).optional().describe('Timeout for waitForUrl in milliseconds (default 15000).'),
        bodyForUrl: z.string().optional().describe('Return the response body of the most recent completed request whose URL contains this substring.'),
      },
    },
    (args) =>
      cdpTool(sessionId, args.tab, async (webContentsId) => {
        assertExperimental(isCdpNetworkEnabled())
        await enableNetworkCapture(webContentsId)
        if (args.bodyForUrl) {
          const body = await getResponseBody(webContentsId, args.bodyForUrl)
          if (!body) throw new Error(`No completed request found matching: ${args.bodyForUrl}`)
          return body
        }
        if (args.waitForUrl) {
          const hit = await waitForRequest(webContentsId, args.waitForUrl, args.timeoutMs ?? 15000)
          if (!hit) throw new Error(`Timed out waiting for a request matching: ${args.waitForUrl}`)
          return hit
        }
        return { requests: readNetwork(webContentsId, args) }
      }),
  )

  if (isCdpCookiesEnabled()) server.registerTool(
    'browser_cookies',
    {
      description:
        'Read the cookies visible to the page (requires the browser CDP setting). Returns name, value, domain, path, and key flags. Long cookie values are truncated (a valueLength field carries the original length). Pass urls to scope to specific URLs.',
      inputSchema: {
        ...tabField,
        ...descriptionField,
        urls: z.array(z.string()).optional().describe('Only return cookies that would be sent to these URLs. Omit for the current page.'),
      },
    },
    (args) =>
      cdpTool(sessionId, args.tab, async (webContentsId) => {
        assertExperimental(isCdpCookiesEnabled())
        return { cookies: await cdpGetCookies(webContentsId, args.urls) }
      }),
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

  if (isCdpEmulateEnabled()) server.registerTool(
    'browser_emulate',
    {
      description:
        'Emulate device and environment conditions for the page (requires the browser CDP setting AND the device-emulation sub-setting): viewport size, device scale, mobile mode, user agent, color scheme, timezone, locale, and geolocation. Pass reset:true to clear all overrides. Overrides persist until reset or the tab is closed. Note: width/height reflow responsive pages (those with a width=device-width viewport meta) to the emulated width; non-responsive pages keep their wide layout, matching standard device-emulation behavior.',
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
        assertExperimental(isCdpEmulateEnabled())
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

  if (isCdpMockEnabled()) server.registerTool(
    'browser_mock',
    {
      description:
        'Intercept matching network requests and respond with a mocked response (requires the browser CDP setting AND the network-mocking sub-setting). Provide a url substring to match and the response to return. Pass clear:true to remove all mocks. WARNING: this can read and alter all page traffic — use only in trusted scenarios.',
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
        assertExperimental(isCdpMockEnabled())
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
