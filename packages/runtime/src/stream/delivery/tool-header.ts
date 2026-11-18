import { decode } from '@toon-format/toon'
import { isSuperoneMcpServerName, parseMcpToolName } from '@superone/shared/tool-ui'
import { compactMediaToolResult, unwrapMcpEnvelope } from './remote-content'

export const SHELL_INPUT_MAX = 1024
const listFields: Record<string, string> = {
  project_list: 'projects', session_list: 'sessions', session_search: 'hits',
  environment_get_info: 'environments', environment_list: 'environments',
}
// These compact rows are fully described by their existing sanitized input.
const inputOnlyTools = new Set(['read_manual', 'session_tag', 'miniapp_dev_register', 'miniapp_dev_update_types',
  'miniapp_dev_preview', 'miniapp_dev_reload', 'widget_list_templates', 'speech_list_providers',
  'speech_generate', 'speech_transcribe'])
const namedTools = new Set(['config_read', 'miniapp_open'])

/** Keep the same localized presenter for a successful call while leaving list bodies at the host. */
export function compactToolHeader(toolName: string, result: string, input: string): string | undefined {
  // A large input may lose its filter/title under the shell input cap. The
  // legacy presenter recovers that subject along with the detail.
  if (typeof input !== 'string' || input.length > SHELL_INPUT_MAX) return
  const name = parseMcpToolName(toolName)
  if (!name || !isSuperoneMcpServerName(name.serverName)) return
  const bare = name.mcpToolName
  const list = Object.hasOwn(listFields, bare) ? listFields[bare] : undefined
  // A tool such as miniapp_dev_preview can also return a screenshot. Keep
  // those image paths available to transcript readers and the gallery.
  if (inputOnlyTools.has(bare)) return compactMediaToolResult(result) ? undefined : '{"remoteRows":0}'
  if (!list && !namedTools.has(bare)) return
  const text = unwrapMcpEnvelope(result)
  try {
    const parsed: unknown = text.trimStart().startsWith('{') ? JSON.parse(text) : decode(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const record = parsed as Record<string, unknown>
    if (record.status && record.status !== 'ok') return
    const rows = list ? record[list] : undefined
    if (list && !Array.isArray(rows)) return
    // Archive inputs redact the original search string. In legacy Codex
    // details that string may still be the visible filter. Fall back unless
    // the projected result itself supplies the same visible query.
    if (list && input) {
      const query = JSON.parse(input)?.query
      if (typeof query === 'string' && query && (bare !== 'session_search' || record.query !== query)) return
    }
    const header = Array.isArray(rows)
      ? { remoteRows: rows.length, count: typeof record.count === 'number' ? record.count : rows.length,
        ...(bare === 'session_search' && typeof record.query === 'string' ? { query: record.query } : {}) }
      : { remoteRows: 0, ...(bare === 'miniapp_open' && typeof record.name === 'string' ? { name: record.name } : {}),
        ...(bare === 'config_read' && typeof record.label === 'string' ? { label: record.label } : {}) }
    // Longer subjects use the dedicated detail path, which preserves the full tooltip.
    const summary = JSON.stringify(header)
    if (summary.length <= 200) return summary
  } catch { /* Older or unrecognized result formats still use the full detail. */ }
}
