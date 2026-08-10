import type { ContentBlock } from '@superone/shared/agent-types'
import type { ToolCallUpdate } from '@agentclientprotocol/sdk'
import { getBuiltinCapability } from '@superone/shared/capability-prompt-tags'
import { formatAgentToolOutput } from '@superone/shared/tool-ui'
import { normalizeAcpTool } from './tool-normalization'

/**
 * Unwrap agent-native rawOutput envelopes into UI text.
 * Implementation lives in @superone/shared/tool-ui (browser-safe) so transcript
 * replay and live ACP mapping share one formatter.
 */
export function formatAcpRawOutput(raw: unknown): string {
  return formatAgentToolOutput(raw)
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
 * session_list / session_search / session_read / session_cleanup — result is
 * TOON or large markdown the SessionArchiveToolBlock must parse. Do not match
 * session_list_agents or session_collab_*.
 */
function isSessionArchiveToolName(toolName: string | undefined): boolean {
  if (!toolName) return false
  return /(?:^|__)session_(?:list|search|read|cleanup)$/.test(toolName)
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

/** Production list/search payloads are TOON tables — mid-string slice makes decode fail → UI "0 sessions". */
function looksLikeSessionArchiveToon(summary: string): boolean {
  const t = summary.trim()
  if (/(?:^|\n)sessions\[\d+\]/.test(t)) return true
  if (/(?:^|\n)hits\[\d+\]/.test(t)) return true
  if (t.includes('projectPath:') && (t.includes('sessions[') || t.includes('hits['))) return true
  return false
}

function looksLikeSessionArchiveJson(obj: Record<string, unknown>): boolean {
  return Array.isArray(obj.sessions)
    || Array.isArray(obj.hits)
    || (typeof obj.action === 'string'
      && (Array.isArray(obj.deleted)
        || Array.isArray(obj.affected)
        || Array.isArray(obj.candidates)
        || Array.isArray(obj.failed)))
}

function shouldKeepFullToolResult(summary: string, toolName?: string): boolean {
  if (summary.length <= 4000) return true
  if (isCollabToolName(toolName)) return true
  if (isSessionArchiveToolName(toolName)) return true
  if (looksLikeSessionArchiveToon(summary)) return true
  const trimmed = summary.trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>
    return (typeof obj.widget_code === 'string' && obj.widget_code.length > 0)
      || looksLikeCollabResult(obj)
      || looksLikeSessionArchiveJson(obj)
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
