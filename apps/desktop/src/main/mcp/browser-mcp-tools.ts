import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { browserAutomationCall, type BrowserAutomationOp } from '../browser/browser-automation-bridge'

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
  'browser_select',
  'browser_open',
  'browser_evaluate',
  'browser_tabs',
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

const tabField = {
  tab: z
    .string()
    .optional()
    .describe('Browser view id. Omit to target the focused browser view (errors if multiple are open).'),
}

export function registerBrowserTools(server: McpServer, sessionId: string): void {
  server.registerTool(
    'browser_snapshot',
    {
      description:
        'Inspect the current browser page before acting. Returns url/title/loading, the top interactive elements with reusable CSS selectors, the total element count, optional truncated text, and recent console entries. Call this first to orient; default is lean (no text, error-only console).',
      inputSchema: {
        ...tabField,
        filter: z
          .string()
          .optional()
          .describe('Case-insensitive substring; only return interactive elements whose name or role contains it.'),
        max: z.number().int().min(1).max(200).default(40).describe('Max interactive elements, ranked by viewport proximity. Default 40.'),
        text: z.boolean().default(false).describe('Include truncated visible page text. Default false.'),
        console: z.enum(['none', 'error', 'all']).default('error').describe("Console entries to include. Default 'error'."),
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
        'Capture a PNG screenshot of the browser page, or of one element when a selector is given. Use only when text-based inspection is not enough — screenshots are expensive.',
      inputSchema: {
        ...tabField,
        selector: z.string().optional().describe('CSS selector to screenshot just that element. Omit for the full viewport.'),
      },
    },
    async (args) => {
      try {
        const result = (await browserAutomationCall(sessionId, 'screenshot', args)) as ScreenshotResult
        return {
          content: [{ type: 'image' as const, data: result.data, mimeType: result.mimeType }],
        }
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
        selector: z.string().optional().describe('CSS selector of the element to click.'),
        text: z.string().optional().describe('Click the first visible element whose accessible name or text contains this substring.'),
        x: z.number().optional().describe('Viewport X coordinate in CSS pixels. Must be paired with y.'),
        y: z.number().optional().describe('Viewport Y coordinate in CSS pixels. Must be paired with x.'),
      },
    },
    (args) => dataTool(sessionId, 'click', args),
  )

  server.registerTool(
    'browser_type',
    {
      description:
        'Type text into an input. Prefer selector with a CSS selector; if omitted, types into the currently focused element. Set clear=true to replace existing text. Dispatches native input/change events so framework-controlled inputs update.',
      inputSchema: {
        ...tabField,
        text: z.string().describe('Literal text to insert.'),
        selector: z.string().optional().describe('CSS selector of the input. Omit to type into the focused element.'),
        clear: z.boolean().default(false).describe('Clear the existing value before typing. Default false.'),
      },
    },
    (args) => dataTool(sessionId, 'type', args),
  )

  server.registerTool(
    'browser_navigate',
    {
      description:
        'Change the page the browser shows. Provide exactly one of: url (a website), port (a local dev-server on localhost), or action (back/forward/reload to move through history). Waits for the page to stop loading by default.',
      inputSchema: {
        ...tabField,
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
        "Press one keyboard key, e.g. { key: 'Enter' }, { key: 'Escape' }, or { key: 'a', modifiers: ['Meta'] }. Targets the element at selector, or the focused element if omitted. Note: dispatches synthetic key events (handlers that listen for them fire); Enter additionally submits the enclosing form when no modifiers are held.",
      inputSchema: {
        ...tabField,
        key: z.string().min(1).describe("Key name such as Enter, Escape, Tab, ArrowDown, Backspace, or a single character."),
        modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).optional().describe('Modifier keys held while pressing.'),
        selector: z.string().optional().describe('CSS selector of the key target. Omit to target the focused element.'),
      },
    },
    (args) => dataTool(sessionId, 'press', args),
  )

  server.registerTool(
    'browser_scroll',
    {
      description:
        'Scroll by CSS pixels. Positive deltaY scrolls down, positive deltaX scrolls right. Without a selector it scrolls the viewport; with one it scrolls that container. Provide at least one delta. Useful to trigger lazy-loading or reveal off-screen elements.',
      inputSchema: {
        ...tabField,
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

  server.registerTool(
    'browser_select',
    {
      description:
        'Set the value of a <select> dropdown (by value, visible label, or index) or toggle a checkbox/radio (by checked). Provide the selector plus exactly one of value, label, index, or checked. Dispatches native change events.',
      inputSchema: {
        ...tabField,
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
}
