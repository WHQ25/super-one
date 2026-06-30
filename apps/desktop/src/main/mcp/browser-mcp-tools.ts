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

async function dataTool(op: BrowserAutomationOp, input: unknown): Promise<ToolReply> {
  try {
    return textReply(await browserAutomationCall(op, input))
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

export function registerBrowserTools(server: McpServer): void {
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
    (args) => dataTool('snapshot', args),
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
    (args) => dataTool('query', args),
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
    (args) => dataTool('inspect', args),
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
        const result = (await browserAutomationCall('screenshot', args)) as ScreenshotResult
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
    (args) => dataTool('click', args),
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
    (args) => dataTool('type', args),
  )

  server.registerTool(
    'browser_navigate',
    {
      description:
        'Navigate the browser to a URL or a local dev-server port. Provide exactly one of url or port. Waits for the page to stop loading by default.',
      inputSchema: {
        ...tabField,
        url: z.string().optional().describe("Website URL, e.g. https://example.com. A schemeless host like 'example.com' gets https; loopback gets http."),
        port: z.number().int().min(1).max(65535).optional().describe('Local dev-server port on localhost.'),
        path: z.string().optional().describe("Optional path/query for the port form, e.g. '/settings'."),
        protocol: z.enum(['http', 'https']).optional().describe("Protocol for the port form. Defaults to http."),
        readiness: z.enum(['load', 'none']).default('load').describe("'load' waits for loading to stop (default); 'none' returns immediately."),
      },
    },
    (args) => dataTool('navigate', args),
  )
}
