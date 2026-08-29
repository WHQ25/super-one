/**
 * Compact 8-tool browser surface. Each tool is a dispatcher over the existing
 * primitive handlers — no CDP / automation logic lives here.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { browserErrorReply, browserTextReply, type BrowserToolReply } from './browser-mcp-replies'
import { browserActionSchema } from '../browser/browser-actions'
import { browserAutomationCall } from '../browser/browser-automation-bridge'
import { persistActionRecording } from '../agent/action-recording-store'
import {
  BROWSER_TOOLS_CALL_DESCRIPTION,
  BROWSER_TOOLS_CALL_SUMMARY_DESCRIPTION,
  BROWSER_TOOLS_LIST_DESCRIPTION,
} from './browser-webmcp-tool-defs'

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
      "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
    ),
}

const ACT_TYPES = ['click', 'hover', 'type', 'press', 'scroll', 'drag', 'select', 'upload'] as const
type ActType = (typeof ACT_TYPES)[number]

const ACT_PRIMITIVE: Record<ActType, string> = {
  click: 'browser_click',
  hover: 'browser_hover',
  type: 'browser_type',
  press: 'browser_press',
  scroll: 'browser_scroll',
  drag: 'browser_drag',
  select: 'browser_select',
  upload: 'browser_upload_file',
}

const dragTarget = z.object({
  selector: z.string().optional(),
  text: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
})

const actItemSchema = z.object({
  type: z.enum(ACT_TYPES),
  selector: z.string().optional(),
  text: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  clear: z.boolean().optional(),
  key: z.string().optional(),
  modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).optional(),
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
  from: dragTarget.optional(),
  to: dragTarget.optional(),
  steps: z.number().int().optional(),
  holdMs: z.number().int().optional(),
  humanize: z.boolean().optional(),
  value: z.string().optional(),
  label: z.string().optional(),
  index: z.number().int().optional(),
  checked: z.boolean().optional(),
  files: z.array(z.string()).optional(),
  engine: z.enum(['auto', 'cdp', 'synthetic']).optional(),
})

const NETWORK_ACTIONS = [
  'start',
  'stop',
  'wait',
  'body',
  'download',
  'downloads',
  'cookies',
  'mock',
  'emulate',
] as const

type NetworkAction = (typeof NETWORK_ACTIONS)[number]

const NETWORK_PRIMITIVE: Record<NetworkAction, string> = {
  start: 'browser_network_start',
  stop: 'browser_network_stop',
  wait: 'browser_network_wait',
  body: 'browser_network_body',
  download: 'browser_download',
  downloads: 'browser_list_downloads',
  cookies: 'browser_cookies',
  mock: 'browser_mock',
  emulate: 'browser_emulate',
}

const EMULATE_ONLY_KEYS = [
  'deviceScaleFactor',
  'mobile',
  'userAgent',
  'colorScheme',
  'timezone',
  'locale',
  'latitude',
  'longitude',
] as const

export type PrimitiveRunner = (name: string, args: Record<string, unknown>) => Promise<BrowserToolReply>

function replyText(reply: BrowserToolReply): string {
  return reply.content.map((c) => ('text' in c ? c.text : '')).join('')
}

function parseJson(reply: BrowserToolReply): unknown {
  const text = replyText(reply)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function isExplicitFailure(parsed: unknown): boolean {
  return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as { ok?: unknown }).ok === false)
}

function failureMessage(reply: BrowserToolReply, parsed: unknown): string {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const err = (parsed as { error?: unknown }).error
    if (typeof err === 'string' && err.trim()) return err
  }
  return replyText(reply)
}

export const BROWSER_TABS_DESCRIPTION =
  'Discover and change browser tabs for this session. '
  + 'action=list (default) returns a TOON table of tab id / url / title / loading. '
  + 'action=open creates or reuses a tab (optional url). '
  + 'action=navigate|back|forward|reload changes that tab\'s page — pass url, or port (+ optional path) for localhost. '
  + 'action=close discards tabs you opened and are done with — pass one id or an array; it is not undoable, so never close a tab the user is reading. '
  + 'Use the returned tab id as `tab` on other browser tools. Not for clicking or typing (browser_act).'

export const BROWSER_SNAPSHOT_DESCRIPTION =
  'Inspect the current page. `include` picks sections: meta, elements (flat interactive + CSS selectors), tree (structure), text, console, screenshot. '
  + 'Default [meta, elements, console] (lean). include:[console] skips the DOM scan. include:[screenshot] saves a PNG and returns path — image is NOT loaded; Read the path if pixels matter. '
  + 'Result is TOON unless a screenshot is requested with other sections (then JSON {screenshot, page}). Prefer this before browser_act. Use browser_query when you already know the target.'

export const BROWSER_QUERY_DESCRIPTION =
  'Find or inspect elements. op=search (default) matches role / text / css / attributes and returns a TOON table of reusable selectors. '
  + 'op=inspect returns detail on one selector (fields: text, html, attributes, value, box, styles, context). '
  + 'Use this instead of snapshot when you already know what you are looking for. Do not use this to click or type (browser_act).'

export const BROWSER_ACT_DESCRIPTION =
  'Act on the page: click, hover, type, press, scroll, drag, select, upload. '
  + 'Send ONE action per call by default. Batch 2–20 only for a sequence you would not stop between '
  + '(fill a form then submit) — the user sees a batch as one step. Re-read the page between anything else. '
  + 'Prefer a CSS selector from snapshot/query; click/hover also accept text or x/y. '
  + 'engine=auto|cdp|synthetic (default auto). description is shown to the user instead of raw selectors. '
  + 'recording=true saves a video of just this transaction; expect holds it open until a page condition is met. '
  + 'Not for navigation (browser_tabs), waiting (browser_wait_for), or JS (browser_evaluate). Fail-fast: stops at the first error.'

export const BROWSER_PERF_DESCRIPTION =
  "Profile what a page (or SuperOne itself) burns CPU on: hotspot functions by self time, plus layout/style/heap deltas. "
  + "Pass `action` to measure ONE interaction: the window opens and closes around it, and a ~1s ambient baseline is subtracted. "
  + "Omit `action` to profile steady state for `sampleMs` (no baseline; the only mode for target='app'). "
  + "The reply flags a truncated window or a non-script bottleneck when either applies."

const BROWSER_NETWORK_DESCRIPTION =
  'Network, downloads, and page environment. '
  + 'Recording ladder: action=start → do an act/navigate → action=wait or stop (lean manifest) → action=body({requestId}) for one response. '
  + 'action=download fetches a URL through the session; action=downloads lists page-triggered captures. '
  + 'action=cookies|mock|emulate need CDP experimental settings, except emulate with only preset/width/height/reset. '
  + 'Prefer snapshot/query for page content.'

export const BROWSER_ACTION_DESCRIPTION =
  'Saved semantic browser actions (dynamic catalog — list then do). '
  + 'action=list (optional domain; includeSteps to see the full definition). '
  + 'action=do runs one saved action with input. '
  + 'action=save creates or replaces a named flow (domain+name) — read the manual first. '
  + 'This does not record prior browser calls. Use browser_act for one-off clicks/types.'

export const BROWSER_WAIT_FOR_DESCRIPTION =
  'Block until the page reaches a desired state. Provide at least one condition; all are AND-combined: a css selector that must be visible, a selector that must be gone, a visible-text substring, and/or a URL substring. Use after browser_act or browser_tabs navigate when the page changes asynchronously. Defaults to 15s, max 60s. Do not sleep+poll with snapshot yourself.'

export const BROWSER_EVALUATE_DESCRIPTION =
  'Evaluate a JavaScript expression in the page and return its serializable result. Prefer snapshot and browser_act; use evaluate only for inspection or interactions those tools cannot express. The expression may mutate page state. A returned Promise is awaited. A large result (>32KB) is spilled to a file as { spilled:true, path, bytes, preview }.'

export function registerCompactBrowserTools(
  server: McpServer,
  sessionId: string,
  runPrimitive: PrimitiveRunner,
  webMcpEnabled: boolean,
): void {
  if (webMcpEnabled) {
    server.registerTool(
      'browser_tools_list',
      {
        description: BROWSER_TOOLS_LIST_DESCRIPTION,
        inputSchema: { ...tabField },
      },
      (args) => runPrimitive('browser_tools_list', args),
    )
    server.registerTool(
      'browser_tools_call',
      {
        description: BROWSER_TOOLS_CALL_DESCRIPTION,
        inputSchema: {
          ...tabField,
          description: z.string().optional().describe(BROWSER_TOOLS_CALL_SUMMARY_DESCRIPTION),
          // Typed optional on purpose. Declared required, the MCP layer rejects a missing `name`
          // before the host runs, and the agent gets an `MCP error -32602` the chat row cannot
          // attribute to any page — no origin, no favicon, no available-tool list. Letting the
          // call through lets `executeWebMcpCall` answer with its own identified reply instead.
          name: z.string().optional().describe('Tool name from browser_tools_list. Required.'),
          input: z
            .record(z.string(), z.unknown())
            .default({})
            .describe('Arguments; validated against the page-declared inputSchema at dispatch time.'),
        },
      },
      (args) => runPrimitive('browser_tools_call', args),
    )
  }

  server.registerTool(
    'browser_wait_for',
    {
      description: BROWSER_WAIT_FOR_DESCRIPTION,
      inputSchema: {
        ...tabField,
        ...descriptionField,
        selector: z.string().optional().describe('CSS selector that must be present and visible.'),
        selectorGone: z.string().optional().describe('CSS selector that must be absent or hidden.'),
        text: z.string().optional().describe('Substring that must appear in visible document text.'),
        urlIncludes: z.string().optional().describe('Substring that must appear in the current URL.'),
        timeoutMs: z.number().int().min(100).max(60000).optional().describe('Maximum wait in milliseconds. Default 15000, max 60000.'),
      },
    },
    (args) => runPrimitive('browser_wait_for', args),
  )

  server.registerTool(
    'browser_evaluate',
    {
      description: BROWSER_EVALUATE_DESCRIPTION,
      inputSchema: {
        ...tabField,
        ...descriptionField,
        expression: z.string().min(1).max(64000).describe('JavaScript expression to evaluate in the page.'),
      },
    },
    (args) => runPrimitive('browser_evaluate', args),
  )

  server.registerTool(
    'browser_tabs',
    {
      description: BROWSER_TABS_DESCRIPTION,
      inputSchema: {
        ...descriptionField,
        action: z
          .enum(['list', 'open', 'navigate', 'back', 'forward', 'reload', 'close'])
          .optional()
          .describe('Default list.'),
        tab: z
          .union([z.string(), z.array(z.string()).min(1)])
          .optional()
          .describe('Existing tab id to reuse (open) or target (navigate/history/close). An array is only valid with action=close.'),
        url: z.string().optional().describe('Website URL for open/navigate. Schemeless host gets https; loopback gets http.'),
        port: z.number().int().min(1).max(65535).optional().describe('Localhost port for navigate.'),
        path: z.string().optional().describe('Optional path/query for the port form.'),
        protocol: z.enum(['http', 'https']).optional().describe('Protocol for the port form. Defaults to http.'),
        readiness: z.enum(['load', 'none']).optional().describe("'load' waits for loading to stop (default); 'none' returns immediately."),
      },
    },
    async (args) => {
      const action = args.action ?? 'list'
      if (action === 'list') return runPrimitive('browser_tabs', {})
      if (action === 'close') {
        return runPrimitive('browser_close', {
          description: args.description,
          tab: args.tab,
        })
      }
      // Only close is a set operation. Silently using the first id for open or
      // navigate would act on a tab the caller did not single out.
      if (Array.isArray(args.tab)) {
        return browserErrorReply(new Error('An array of tab ids is only valid with action=close.'))
      }
      if (action === 'open') {
        return runPrimitive('browser_open', {
          description: args.description,
          url: args.url,
          tab: args.tab,
          readiness: args.readiness,
        })
      }
      return runPrimitive('browser_navigate', {
        description: args.description,
        tab: args.tab,
        url: args.url,
        port: args.port,
        path: args.path,
        protocol: args.protocol,
        action: action === 'navigate' ? undefined : action,
        readiness: args.readiness,
      })
    },
  )

  server.registerTool(
    'browser_snapshot',
    {
      description: BROWSER_SNAPSHOT_DESCRIPTION,
      inputSchema: {
        ...tabField,
        ...descriptionField,
        include: z
          .array(z.enum(['meta', 'elements', 'tree', 'text', 'console', 'screenshot']))
          .optional()
          .describe("Which sections to return. Default ['meta','elements','console']."),
        filter: z.string().optional(),
        max: z.number().int().min(1).max(200).optional(),
        depth: z.number().int().min(1).max(30).optional(),
        treeMax: z.number().int().min(1).max(500).optional(),
        textMaxChars: z.number().int().min(0).max(20000).optional(),
        selector: z.string().optional().describe('Element to screenshot when include contains screenshot.'),
        console: z
          .object({
            level: z.array(z.enum(['log', 'info', 'warning', 'error'])).optional(),
            grep: z.string().optional(),
            regex: z.boolean().optional(),
            ignoreCase: z.boolean().optional(),
            invert: z.boolean().optional(),
            max: z.number().int().min(1).max(200).optional(),
          })
          .optional(),
      },
    },
    async (args) => {
      const include = args.include ?? ['meta', 'elements', 'console']
      const wantShot = include.includes('screenshot')
      const pageInclude = include.filter((s) => s !== 'screenshot')
      let pageReply: BrowserToolReply | null = null
      if (pageInclude.length > 0) {
        pageReply = await runPrimitive('browser_snapshot', { ...args, include: pageInclude })
        if (pageReply.isError) return pageReply
      }
      if (!wantShot) return pageReply ?? browserTextReply({ ok: true })
      const shot = await runPrimitive('browser_screenshot', {
        tab: args.tab,
        description: args.description,
        selector: args.selector,
      })
      if (shot.isError) return shot
      if (!pageReply) return shot
      return browserTextReply({
        screenshot: parseJson(shot),
        page: replyText(pageReply),
      })
    },
  )

  server.registerTool(
    'browser_query',
    {
      description: BROWSER_QUERY_DESCRIPTION,
      inputSchema: {
        ...tabField,
        ...descriptionField,
        op: z.enum(['search', 'inspect']).optional().describe('Default search.'),
        role: z.string().optional(),
        text: z.string().optional(),
        selector: z.string().optional().describe('CSS selector. Required for inspect.'),
        attributes: z.record(z.string(), z.string()).optional(),
        visible: z.boolean().optional(),
        max: z.number().int().min(1).max(100).optional(),
        fields: z.array(z.enum(['text', 'html', 'attributes', 'value', 'box', 'styles', 'context'])).optional(),
        maxChars: z.number().int().min(0).max(20000).optional(),
      },
    },
    async (args) => {
      if ((args.op ?? 'search') === 'inspect') {
        if (typeof args.selector !== 'string' || !args.selector) {
          return browserErrorReply(new Error('op=inspect requires selector.'))
        }
        return runPrimitive('browser_inspect', {
          tab: args.tab,
          description: args.description,
          selector: args.selector,
          fields: args.fields,
          maxChars: args.maxChars,
        })
      }
      return runPrimitive('browser_query', args)
    },
  )

  server.registerTool(
    'browser_act',
    {
      description: BROWSER_ACT_DESCRIPTION,
      inputSchema: {
        ...tabField,
        ...descriptionField,
        actions: z.array(actItemSchema).min(1).max(20).describe('Normally one action. Use 2–20 only for a single uninterruptible sequence; they run in order, fail-fast.'),
        recording: z.boolean().optional().describe('Save a video of only this action transaction. Default false.'),
        expect: z.object({
          selector: z.string().optional(),
          selectorGone: z.string().optional(),
          text: z.string().optional(),
          urlIncludes: z.string().optional(),
        }).optional().describe('Explicit completion condition checked before recording stops.'),
        timeoutMs: z.number().int().min(100).max(60_000).optional()
          .describe('Maximum wait for expect. Default 15000.'),
      },
    },
    async (args) => {
      const actions = args.actions as Array<Record<string, unknown>>
      const description = args.description
      const tab = args.tab
      let recordingId: string | undefined
      let recordingTab: string | undefined
      if (args.recording === true) {
        try {
          const started = await browserAutomationCall(sessionId, 'recordStart', { tab }) as {
            recordingId?: string
            tab?: string
          }
          if (!started.recordingId) throw new Error('Browser recording did not start')
          recordingId = started.recordingId
          recordingTab = started.tab
        } catch (error) {
          return browserErrorReply(error)
        }
      }
      const operationTab = recordingTab ?? tab

      let actionReply: BrowserToolReply = browserTextReply({ ok: false, error: 'Action did not run' })
      try {
        const executed: Array<{ type: string; ok: true }> = []
        let last: unknown = null
        actionReply = browserTextReply({ ok: true, stepsExecuted: 0, last })
        for (const action of actions) {
          const type = action.type as ActType
          const primitive = ACT_PRIMITIVE[type]
          if (!primitive) {
            actionReply = browserErrorReply(new Error(`Unknown action type: ${String(action.type)}`))
            break
          }
          const { type: _t, ...rest } = action
          if ((type === 'type' || type === 'press') && rest.engine === 'auto') {
            delete rest.engine
          }
          const reply = await runPrimitive(primitive, { ...rest, tab: operationTab, description })
          const parsed = parseJson(reply)
          const failed = reply.isError || isExplicitFailure(parsed)
          if (failed) {
            actionReply = {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  ok: false,
                  failedAt: type,
                  step: executed.length,
                  executed,
                  error: failureMessage(reply, parsed),
                }),
              }],
              isError: true,
            }
            break
          }
          executed.push({ type, ok: true })
          last = parsed
          actionReply = browserTextReply({ ok: true, stepsExecuted: executed.length, last })
        }

        if (!actionReply.isError && args.expect) {
          const waitReply = await runPrimitive('browser_wait_for', {
            tab: operationTab,
            description,
            ...(args.expect as Record<string, unknown>),
            timeoutMs: args.timeoutMs,
          })
          if (waitReply.isError || isExplicitFailure(parseJson(waitReply))) {
            actionReply = waitReply
          } else {
            actionReply = browserTextReply({
              ...(parseJson(actionReply) as Record<string, unknown>),
              completion: parseJson(waitReply),
            })
          }
        } else if (!actionReply.isError && recordingId) {
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      } catch (error) {
        actionReply = browserErrorReply(error)
      }

      if (!recordingId) return actionReply
      try {
        const stopped = await browserAutomationCall(sessionId, 'recordStop', {
          tab: operationTab,
          recordingId,
        }) as {
          data: string
          mimeType: string
          durationMs: number
          width: number
          height: number
        }
        const path = persistActionRecording('web', stopped.data, stopped.mimeType)
        if (!path) throw new Error('Browser recording could not be saved')
        const parsed = parseJson(actionReply)
        const body = parsed && typeof parsed === 'object'
          ? parsed as Record<string, unknown>
          : { result: parsed }
        return {
          ...browserTextReply({
            ...body,
            recording: {
              savedPath: path,
              mimeType: stopped.mimeType,
              durationMs: stopped.durationMs,
              width: stopped.width,
              height: stopped.height,
            },
          }),
          ...(actionReply.isError ? { isError: true } : {}),
        }
      } catch (error) {
        return browserErrorReply(new Error(
          `The browser action ran, but its recording could not be finalized: ${error instanceof Error ? error.message : String(error)}`,
        ))
      }
    },
  )

  server.registerTool(
    'browser_perf',
    {
      description: BROWSER_PERF_DESCRIPTION,
      inputSchema: {
        ...tabField,
        ...descriptionField,
        target: z.enum(['tab', 'app']).optional().describe("'tab' (default) = a browser view. 'app' = SuperOne's own renderer; sample mode only."),
        action: z
          .object({
            tool: z.string().describe("Browser primitive to measure, e.g. 'browser_click', 'browser_navigate', 'browser_scroll'."),
            args: z.record(z.string(), z.unknown()).optional().describe('Arguments for that tool, as you would pass them directly.'),
          })
          .optional()
          .describe('Action mode: the action runs inside the profiling window. Omit for sample mode.'),
        sampleMs: z.number().int().optional().describe('Sample mode: how long to profile steady-state load. Default 3000.'),
        until: z
          .object({
            urlContains: z.string().optional(),
            selector: z.string().optional(),
          })
          .optional()
          .describe('Action mode: explicit completion signal for an exact window.'),
        maxWaitMs: z.number().int().optional().describe('Action mode: upper bound on the wait. Default 10000.'),
        baselineMs: z.number().int().optional().describe("Action mode: ambient-load sample length. Default 1000."),
      },
    },
    (args) => runPrimitive('browser_perf_measure', args as Record<string, unknown>),
  )

  server.registerTool(
    'browser_network',
    {
      description: BROWSER_NETWORK_DESCRIPTION,
      inputSchema: {
        ...tabField,
        ...descriptionField,
        action: z.enum(NETWORK_ACTIONS).describe('Which network/env operation to run.'),
        recordingId: z.string().optional().describe('From action=start. Required for stop/wait/body.'),
        requestId: z.string().optional().describe('From a stop/wait manifest. Required for body.'),
        match: z.string().optional(),
        resourceTypes: z.array(z.string()).optional(),
        captureBodies: z.boolean().optional(),
        max: z.number().int().optional(),
        keep: z.boolean().optional().describe('stop only: peek without tearing down.'),
        url: z.string().optional().describe('wait: substring to match. download: absolute URL. mock: url substring.'),
        timeoutMs: z.number().int().optional(),
        filename: z.string().optional(),
        dir: z.string().optional().describe('download only: absolute directory to save into. Defaults to the configured download directory.'),
        state: z.enum(['all', 'progressing', 'completed', 'failed']).optional(),
        wait: z.boolean().optional().describe('downloads only: block until captures settle.'),
        urls: z.array(z.string()).optional().describe('cookies only.'),
        status: z.number().int().optional(),
        body: z.string().optional(),
        contentType: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        clear: z.boolean().optional(),
        preset: z.enum(['mobile', 'tablet', 'desktop']).optional().describe('emulate: named viewport (no CDP).'),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        reset: z.boolean().optional(),
        deviceScaleFactor: z.number().optional(),
        mobile: z.boolean().optional(),
        userAgent: z.string().optional(),
        colorScheme: z.enum(['light', 'dark', 'no-preference']).optional(),
        timezone: z.string().optional(),
        locale: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      },
    },
    async (args) => {
      const action = args.action as NetworkAction
      if (action === 'emulate') {
        const needsFullEmulate = EMULATE_ONLY_KEYS.some((k) => args[k] != null)
        if (!needsFullEmulate) {
          return runPrimitive('browser_resize', {
            tab: args.tab,
            description: args.description,
            preset: args.preset,
            width: args.width,
            height: args.height,
            reset: args.reset,
          })
        }
      }
      const primitive = NETWORK_PRIMITIVE[action]
      if (!primitive) return browserErrorReply(new Error(`Unknown network action: ${String(action)}`))
      return runPrimitive(primitive, args)
    },
  )

  server.registerTool(
    'browser_action',
    {
      description: BROWSER_ACTION_DESCRIPTION,
      inputSchema: {
        action: z.enum(['list', 'save', 'do']).describe('list / save / do.'),
        domain: browserActionSchema.shape.domain.optional(),
        name: z.string().optional(),
        includeSteps: z.boolean().optional(),
        description: browserActionSchema.shape.description.optional(),
        parameters: browserActionSchema.shape.parameters.optional(),
        // Deliberately loose: the real grammar is a recursive discriminated union whose
        // $defs cost ~1.2k tokens on EVERY turn, to serve `action=save` alone. The full
        // schema still runs server-side in normalizeAction, so a malformed save is
        // rejected with the same Zod error — only the advertising is deferred.
        steps: z.array(z.record(z.string(), z.unknown())).min(1).max(50).optional()
          .describe('save only: 1-50 flow steps, each {kind:"tool"|"action"|"set"|"if"|"forEach"|"repeat"}. '
            + 'Read read_manual({ domain: "product", topic: "browser" }) for the grammar before writing them.'),
        input: z.record(z.string(), z.unknown()).optional(),
        tab: z.string().optional(),
      },
    },
    async (args) => {
      const action = args.action as 'list' | 'save' | 'do'
      if (action === 'list') {
        return runPrimitive('browser_action_list', { domain: args.domain, includeSteps: args.includeSteps })
      }
      if (action === 'save') {
        return runPrimitive('browser_action_save', {
          domain: args.domain,
          name: args.name,
          description: args.description,
          parameters: args.parameters,
          steps: args.steps,
        })
      }
      return runPrimitive('browser_action_do', {
        domain: args.domain,
        name: args.name,
        input: args.input ?? {},
        tab: args.tab,
      })
    },
  )
}
