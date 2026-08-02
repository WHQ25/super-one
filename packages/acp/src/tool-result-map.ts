import type { ContentBlock } from '@superone/shared/agent-types'
import type { ToolCallUpdate } from '@agentclientprotocol/sdk'
import { getBuiltinCapability } from '@superone/shared/capability-prompt-tags'
import { normalizeAcpTool } from './tool-normalization'

function bytesOrStringToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((n) => typeof n === 'number')) {
    try {
      return Buffer.from(value as number[]).toString('utf8')
    } catch {
      return ''
    }
  }
  return ''
}

function formatSearchToolPayload(obj: Record<string, unknown>): string | null {
  let data: unknown = obj
  if (typeof obj.content === 'string' && obj.content.trim()) {
    try {
      data = JSON.parse(obj.content)
    } catch {
      // content may already be a display string
      if (!obj.results) return obj.content
    }
  }
  if (!data || typeof data !== 'object') return null
  const root = data as Record<string, unknown>
  const results = root.results
  if (!Array.isArray(results)) {
    if (typeof root.content === 'string') return root.content
    return null
  }
  const lines: string[] = []
  const count = typeof obj.result_count === 'number' ? obj.result_count : results.length
  lines.push(`Found ${count} tool${count === 1 ? '' : 's'}`)
  for (const entry of results) {
    if (!entry || typeof entry !== 'object') continue
    const group = entry as Record<string, unknown>
    const server = typeof group.server === 'string' ? group.server : 'MCP'
    lines.push('')
    lines.push(`[${server}]`)
    const tools = group.tools
    if (!Array.isArray(tools)) continue
    for (const tool of tools) {
      if (!tool || typeof tool !== 'object') continue
      const t = tool as Record<string, unknown>
      const name = typeof t.tool_name === 'string' ? t.tool_name : typeof t.name === 'string' ? t.name : 'tool'
      const desc = typeof t.description === 'string' ? t.description : ''
      const score = typeof t.score === 'number' ? ` · ${t.score.toFixed(1)}` : ''
      lines.push(desc ? `  ${name}${score} — ${desc}` : `  ${name}${score}`)
    }
  }
  if (typeof root.note === 'string' && root.note.trim()) {
    lines.push('')
    lines.push(root.note)
  }
  return lines.join('\n').trim() || null
}

/**
 * Unwrap agent-native rawOutput envelopes (Grok Build / OpenCode / similar) into UI text.
 * Prefer the human tree/listing string over dumping the whole JSON wrapper.
 */
function isAgentOutputEnvelope(obj: Record<string, unknown>): boolean {
  const t = obj.type
  return (
    t === 'MCP'
    || t === 'ListDir'
    || t === 'list_dir'
    || t === 'LS'
    || t === 'Todo'
    || t === 'SearchTool'
    || t === 'GrepSearch'
    || t === 'grep'
    || obj.TodosUpdated != null
    || (obj.Content != null && typeof obj.Content === 'object')
    || Array.isArray(obj.results)
    || (obj.action != null && typeof obj.action === 'object')
  )
}

export function formatAcpRawOutput(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && isAgentOutputEnvelope(parsed as Record<string, unknown>)) {
          return formatAcpRawOutput(parsed)
        }
        return raw
      } catch {
        return raw
      }
    }
    return raw
  }
  if (typeof raw !== 'object') return String(raw)

  const obj = raw as Record<string, unknown>

  // MCP: { type: "MCP", server_name, tool_name, output: { OkayOutput: "<payload>" } }.
  // The output key is grok's serde variant tag — read the payload structurally so error
  // variants unwrap the same way without hardcoding the tag set.
  if (obj.type === 'MCP' && obj.output != null) {
    if (typeof obj.output === 'string') return obj.output
    if (typeof obj.output === 'object') {
      const values = Object.values(obj.output as Record<string, unknown>)
      if (values.length === 1 && typeof values[0] === 'string') return values[0]
    }
  }

  // ListDir: { type: "ListDir", Content: { content: "- /path\n  - a", absolute_root_path?: string } }
  const listContent = obj.Content ?? obj.content
  if (
    (obj.type === 'ListDir' || obj.type === 'list_dir' || obj.type === 'LS')
    && listContent
    && typeof listContent === 'object'
  ) {
    const body = listContent as Record<string, unknown>
    if (typeof body.content === 'string' && body.content.trim()) return body.content
    if (typeof body.text === 'string' && body.text.trim()) return body.text
  }
  // Sometimes Content is the tree string directly
  if ((obj.type === 'ListDir' || obj.type === 'list_dir') && typeof obj.Content === 'string') {
    return obj.Content
  }
  if (typeof obj.content === 'string' && obj.content.includes('\n') && (obj.type === 'ListDir' || obj.absolute_root_path != null)) {
    return obj.content
  }

  // Todo: { type: "Todo", TodosUpdated: { summary_for_prompt: "..." } }
  if (obj.type === 'Todo' || obj.TodosUpdated != null) {
    const todos = obj.TodosUpdated
    if (todos && typeof todos === 'object') {
      const t = todos as Record<string, unknown>
      if (typeof t.summary_for_prompt === 'string' && t.summary_for_prompt.trim()) return t.summary_for_prompt
      if (typeof t.summary === 'string' && t.summary.trim()) return t.summary
    }
  }

  // SearchTool: MCP tool discovery results (envelope or bare { results: [...] })
  if (
    obj.type === 'SearchTool'
    || Array.isArray(obj.results)
    || (obj.result_count != null && (obj.content != null || obj.results != null))
  ) {
    const formatted = formatSearchToolPayload(obj)
    if (formatted) return formatted
  }

  // GrepSearch: stdout may be a UTF-8 byte array
  if (obj.type === 'GrepSearch' || obj.type === 'grep' || Array.isArray(obj.stdout)) {
    const text = bytesOrStringToText(obj.stdout ?? obj.content ?? obj.output)
    if (text) return text
  }

  // Web search action payload: { action: { type: "search", query, sources: [...] } }
  const action = obj.action
  if (action && typeof action === 'object') {
    const a = action as Record<string, unknown>
    if (a.type === 'search') {
      const lines: string[] = []
      if (typeof a.query === 'string') lines.push(`Query: ${a.query}`)
      const sources = a.sources
      if (Array.isArray(sources)) {
        for (const s of sources) {
          if (s && typeof s === 'object') {
            const src = s as Record<string, unknown>
            if (typeof src.url === 'string') lines.push(src.url)
            else if (typeof src.title === 'string') lines.push(src.title)
          }
        }
      }
      if (typeof a.result === 'string') lines.push(a.result)
      if (typeof a.snippet === 'string') lines.push(a.snippet)
      if (lines.length > 0) return lines.join('\n')
    }
  }

  // Nested Content envelope without type (or type casing variants)
  if (listContent && typeof listContent === 'object') {
    const body = listContent as Record<string, unknown>
    for (const key of ['content', 'text', 'output', 'result']) {
      if (typeof body[key] === 'string' && (body[key] as string).trim()) {
        // Prefer tree-looking listings from ListDir-like payloads
        if (
          obj.type === 'ListDir'
          || obj.type === 'list_dir'
          || obj.type === 'LS'
          || body.absolute_root_path != null
          || /^[\s-]*\//.test(body[key] as string)
        ) {
          return body[key] as string
        }
      }
    }
  }

  // Grok WorkflowToolOutput always includes a human `message` plus run_id/task_id.
  // Prefer compact JSON so tool_result.summary keeps ids for progressive-bus
  // correlation and WorkflowBlock launch parsing (message-only unwrap would drop them).
  if (typeof obj.run_id === 'string' || typeof obj.runId === 'string') {
    try {
      return JSON.stringify(raw)
    } catch {
      return String(raw)
    }
  }

  // Generic nested result / output / text / stdout
  for (const key of ['result', 'output', 'text', 'stdout', 'message', 'summary']) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v
  }
  if (listContent && typeof listContent === 'object') {
    const body = listContent as Record<string, unknown>
    for (const key of ['content', 'text', 'output', 'result']) {
      if (typeof body[key] === 'string' && (body[key] as string).trim()) return body[key] as string
    }
  }

  try {
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}

/**
 * Grok Imagine / video tools return a typed MediaGenOutput as raw_output:
 * `{ type: "ImageGen"|"ImageEdit"|…, path, filename, session_folder }`.
 * SuperOne's chat gallery expects the same shape as media_generate_image
 * (`status` + `savedPaths`). Normalize here so the renderer can show the file
 * without special-casing every agent.
 */
function mediaGenGallerySummary(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const type = typeof obj.type === 'string' ? obj.type : ''
  const isImage = type === 'ImageGen' || type === 'ImageEdit'
  const isVideo = type === 'ImageToVideo' || type === 'ReferenceToVideo'
  if (!isImage && !isVideo) {
    // prompt_text JSON (no type tag): { path, filename, session_folder, message }
    const path = typeof obj.path === 'string' ? obj.path.trim() : ''
    const hasMediaKeys = typeof obj.filename === 'string' || typeof obj.session_folder === 'string'
    if (!path || !hasMediaKeys) return null
    return JSON.stringify({
      status: 'generated',
      savedPaths: [path],
      provider: 'grok',
    })
  }
  const path = typeof obj.path === 'string' ? obj.path.trim() : ''
  if (!path) {
    // ZDR upload-only or empty path — keep default text formatting.
    return null
  }
  return JSON.stringify({
    status: 'generated',
    savedPaths: [path],
    provider: 'grok',
  })
}

export function toolResultFromUpdate(update: ToolCallUpdate, terminalOutput?: string): ContentBlock | null {
  if (update.status !== 'completed' && update.status !== 'failed') return null

  // Prefer structured gallery summary for Grok media tools before text unwrapping.
  if (update.status === 'completed' && update.rawOutput != null) {
    const gallery = mediaGenGallerySummary(update.rawOutput)
    if (gallery) {
      return {
        type: 'tool_result',
        toolUseId: update.toolCallId,
        summary: gallery,
        isError: false,
      }
    }
  }

  const parts: string[] = []
  for (const item of update.content ?? []) {
    if (item.type === 'content' && item.content?.type === 'text') {
      // Agent may put ListDir JSON envelope in text content — unwrap it.
      // Also upgrade Grok prompt_text media JSON into gallery shape when present.
      const text = item.content.text
      const gallery = mediaGenGallerySummary(
        (() => {
          try { return JSON.parse(typeof text === 'string' ? text : '') } catch { return null }
        })(),
      )
      parts.push(gallery ?? formatAcpRawOutput(text))
    } else if (item.type === 'diff') {
      const path = typeof item.path === 'string' ? item.path : ''
      const oldLen = typeof item.oldText === 'string' ? item.oldText.split('\n').length : 0
      const newLen = typeof item.newText === 'string' ? item.newText.split('\n').length : 0
      parts.push(path ? `Updated ${path} (−${oldLen}/+${newLen})` : 'Updated file')
    } else if (item.type === 'terminal') {
      if (terminalOutput) parts.push(terminalOutput)
      else {
        const id = typeof item.terminalId === 'string' ? item.terminalId : ''
        if (id) parts.push(`terminal ${id}`)
      }
    }
  }
  if (terminalOutput && parts.length === 0) parts.push(terminalOutput)
  if (update.rawOutput != null) {
    const formatted = formatAcpRawOutput(update.rawOutput)
    // Prefer unwrapped rawOutput when content parts are empty OR still look like JSON envelopes
    if (parts.length === 0) {
      parts.push(formatted)
    } else if (parts.every((p) => p.trimStart().startsWith('{') || p.trimStart().startsWith('['))) {
      parts.length = 0
      parts.push(formatted)
    }
  }
  const summary = parts
    .map((p) => formatAcpRawOutput(p))
    .join('\n')
  const toolName = normalizeAcpTool(update)?.toolName
  const capped = shouldKeepFullToolResult(summary, toolName) ? summary : summary.slice(0, 4000)
  return {
    type: 'tool_result',
    toolUseId: update.toolCallId,
    summary: capped || (update.status === 'failed' ? 'failed' : 'done'),
    isError: update.status === 'failed',
  }
}

/**
 * session_collab_* results are structured JSON the renderer JSON.parse()s
 * (status/messages/peers); slicing at 4000 chars truncates mid-object and
 * makes it unparsable, so a real reply silently renders as "no messages".
 */
function isCollabToolName(toolName: string | undefined): boolean {
  if (!toolName) return false
  const prefix = getBuiltinCapability('collab')?.toolPrefix
  return !!prefix && toolName.includes(prefix)
}

/**
 * Completion-only ACP updates can be sparse (no title/rawInput to re-derive
 * toolName from), so also recognize the collab envelope by shape — mirrors
 * the same fallback already used below for widget_code.
 */
function looksLikeCollabResult(obj: Record<string, unknown>): boolean {
  return typeof obj.status === 'string'
    && (Array.isArray(obj.messages) || Array.isArray(obj.peers) || Array.isArray(obj.launches) || typeof obj.sessionId === 'string')
}

function shouldKeepFullToolResult(summary: string, toolName?: string): boolean {
  if (summary.length <= 4000) return true
  if (isCollabToolName(toolName)) return true
  const trimmed = summary.trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>
    return (typeof obj.widget_code === 'string' && obj.widget_code.length > 0) || looksLikeCollabResult(obj)
  } catch {
    return false
  }
}

/**
 * Whether this update carries enough tool_use payload to re-emit.
 * Status-only completed/failed updates must NOT re-emit tool_use — that overwrites
 * a good name/input with toolName "tool" / {} (see event-trace acp tool sequences).
 */
export function shouldEmitToolUseUpdate(update: ToolCallUpdate): boolean {
  return !!(
    update.title
    || update.kind
    || update.rawInput !== undefined
    || (update.content && update.content.length > 0)
    || (update.locations && update.locations.length > 0)
    || update.status === 'in_progress'
    || update.status === 'pending'
  )
}
