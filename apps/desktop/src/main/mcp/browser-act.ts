/**
 * The `browser_act` action list, run as the tool runs it: each item mapped
 * to its primitive and executed in order, fail-fast, with the reply the tool
 * returns. One implementation for the tool's own handler and for a
 * `browser_run` hand-over (research doc §11.4), so an action a caller can
 * write for `browser_act` means the same when it is handed to a run.
 */

import { z } from 'zod'
import { browserErrorReply, browserTextReply, type BrowserToolReply } from './browser-mcp-replies'

export type PrimitiveRunner = (name: string, args: Record<string, unknown>) => Promise<BrowserToolReply>

export const ACT_TYPES = ['click', 'hover', 'type', 'press', 'scroll', 'drag', 'select', 'upload'] as const
export type ActType = (typeof ACT_TYPES)[number]

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

export const actItemSchema = z.object({
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

export function replyText(reply: BrowserToolReply): string {
  return reply.content.map((c) => ('text' in c ? c.text : '')).join('')
}

export function parseReply(reply: BrowserToolReply): unknown {
  const text = replyText(reply)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function isExplicitFailure(parsed: unknown): boolean {
  return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as { ok?: unknown }).ok === false)
}

export function failureMessage(reply: BrowserToolReply, parsed: unknown): string {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const err = (parsed as { error?: unknown }).error
    if (typeof err === 'string' && err.trim()) return err
  }
  return replyText(reply)
}

/**
 * Run `actions` in order on `tab`, stopping at the first failure. The reply
 * is `browser_act`'s: `{ ok, stepsExecuted, last }`, or on failure
 * `{ ok: false, failedAt, step, executed, error }` with `isError`.
 */
export async function runBrowserActions(
  runPrimitive: PrimitiveRunner,
  actions: ReadonlyArray<Record<string, unknown>>,
  opts: { tab?: string; description?: string },
): Promise<BrowserToolReply> {
  const executed: Array<{ type: string; ok: true }> = []
  let last: unknown = null
  for (const action of actions) {
    const type = action.type as ActType
    const primitive = ACT_PRIMITIVE[type]
    if (!primitive) return browserErrorReply(new Error(`Unknown action type: ${String(action.type)}`))
    const { type: _t, ...rest } = action
    if ((type === 'type' || type === 'press') && rest.engine === 'auto') delete rest.engine
    const reply = await runPrimitive(primitive, { ...rest, tab: opts.tab, description: opts.description })
    const parsed = parseReply(reply)
    if (reply.isError || isExplicitFailure(parsed)) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: false, failedAt: type, step: executed.length, executed, error: failureMessage(reply, parsed) }),
        }],
        isError: true,
      }
    }
    executed.push({ type, ok: true })
    last = parsed
  }
  return browserTextReply({ ok: true, stepsExecuted: executed.length, last })
}

/** The failure a reply from `runBrowserActions` reports, or null when every action ran. */
export function browserActionsFailure(reply: BrowserToolReply): string | null {
  const parsed = parseReply(reply)
  if (!reply.isError && !isExplicitFailure(parsed)) return null
  return failureMessage(reply, parsed)
}
