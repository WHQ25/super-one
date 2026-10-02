import type { AgentEvent } from '@superone/shared/agent-types'

type PluginNoticeEvent = Extract<AgentEvent, { type: 'plugin_notice' }>

/**
 * What a Claude Code mod shows with `$.ui.log` / `toast` / `status` when no
 * terminal draws it: the CLI streams it to an SDK host as `system/ui_log`,
 * `ui_toast` or `ui_status`. These subtypes are absent from `sdk.d.ts`; the
 * shapes come from the native binary (docs/harness/claude/contracts.md).
 */
export function mapPluginUiMessage(sys: Record<string, unknown>): PluginNoticeEvent | null {
  const { subtype, plugin, text } = sys
  if (typeof plugin !== 'string') return null
  if (subtype === 'ui_status') {
    return { type: 'plugin_notice', kind: 'status', plugin, text: typeof text === 'string' && text ? text : null }
  }
  if ((subtype !== 'ui_log' && subtype !== 'ui_toast') || typeof text !== 'string' || !text) return null
  const timeoutMs = subtype === 'ui_toast' && typeof sys.timeout_ms === 'number' ? sys.timeout_ms : undefined
  return {
    type: 'plugin_notice',
    kind: subtype === 'ui_log' ? 'log' : 'toast',
    plugin,
    text,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  }
}

/**
 * `system/init.plugin_errors` as error notices. Init repeats on every turn of
 * a long-lived process, so `reported` keeps one notice per error per runtime.
 */
export function mapPluginErrors(errors: unknown, reported: Set<string>): PluginNoticeEvent[] {
  if (!Array.isArray(errors)) return []
  const notices: PluginNoticeEvent[] = []
  for (const error of errors as Array<{ plugin?: unknown; type?: unknown; message?: unknown }>) {
    if (typeof error?.plugin !== 'string' || typeof error.message !== 'string') continue
    const key = `${error.plugin}\u0000${String(error.type)}\u0000${error.message}`
    if (reported.has(key)) continue
    reported.add(key)
    notices.push({ type: 'plugin_notice', kind: 'log', plugin: error.plugin, text: error.message, level: 'error' })
  }
  return notices
}
