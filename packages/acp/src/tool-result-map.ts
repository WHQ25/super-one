import type { ContentBlock } from '@superone/shared/agent-types'
import type { ToolCallUpdate } from '@agentclientprotocol/sdk'
import { getBuiltinCapability } from '@superone/shared/capability-prompt-tags'
import { withGrokAutoDenyPrefix } from '@superone/shared/grok-auto-deny'
import {
  isSessionArchiveToolName,
  looksLikeSessionArchiveJson,
  looksLikeSessionArchiveToon,
} from '@superone/shared/session-archive-result-shape'
import {
  isComputerUseToolName,
  looksLikeComputerUseOutline,
  looksLikeComputerUseResult,
} from '@superone/shared/computer-use-result-shape'
import { isJevRunToolName, looksLikeJevRunResult } from '@superone/shared/jev-run-result-shape'
import { FULL_RESULT_TOOL_NAMES, formatAgentToolOutput } from '@superone/shared/tool-ui'
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
 * Grok's background shell returns `{ type: "BackgroundTaskStarted", output_file }`
 * while the command is still running. Claude puts the same signal in the result
 * text ("Output is being written to"). The status bar treats that path as the
 * background receipt.
 */
export function backgroundTaskOutputPath(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  if (record.type !== 'BackgroundTaskStarted') return undefined
  const file = record.output_file ?? record.outputFile
  return typeof file === 'string' && file.length > 0 ? file : undefined
}

/**
 * Grok Imagine / video tools return a typed MediaGenOutput as raw_output:
 * `{ type: "ImageGen"|"ImageEdit"|…, path, filename, session_folder }`.
 * SuperOne's chat gallery expects the same shape as media_generate_image
 * (`status` + `savedPaths`). Normalize here so the renderer can show the file
 * without special-casing every agent.
 */
function stripFileUri(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed.toLowerCase().startsWith('file://')) return trimmed
  try {
    return decodeURIComponent(new URL(trimmed).pathname).replace(/^\/([A-Za-z]:)/, '$1')
  } catch {
    return trimmed.replace(/^file:\/\//i, '')
  }
}

function mediaGenGallerySummary(raw: unknown, content?: ToolCallUpdate['content'], toolName?: string): string | null {
  if (typeof raw === 'string') {
    const match = /Generated image is saved at\s+([^\r\n]+?)\.?\s*$/i.exec(raw.trim())
    const saved = match?.[1] ? stripFileUri(match[1]) : ''
    if (saved) {
      return JSON.stringify({
        status: 'generated',
        savedPaths: [saved],
        provider: 'antigravity',
      })
    }
    return null
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>
    const imagePath = typeof obj.imagePath === 'string' ? stripFileUri(obj.imagePath) : ''
    if (imagePath) {
      return JSON.stringify({
        status: 'generated',
        savedPaths: [imagePath],
        provider: 'antigravity',
      })
    }
    const type = typeof obj.type === 'string' ? obj.type : ''
    const isImage = type === 'ImageGen' || type === 'ImageEdit'
    const isVideo = type === 'ImageToVideo' || type === 'ReferenceToVideo'
    if (!isImage && !isVideo) {
      const path = typeof obj.path === 'string' ? obj.path.trim() : ''
      const hasMediaKeys = typeof obj.filename === 'string' || typeof obj.session_folder === 'string'
      if (path && hasMediaKeys) {
        return JSON.stringify({
          status: 'generated',
          savedPaths: [path],
          provider: 'grok',
        })
      }
    } else {
      const path = typeof obj.path === 'string' ? obj.path.trim() : ''
      if (path) {
        return JSON.stringify({
          status: 'generated',
          savedPaths: [path],
          provider: 'grok',
        })
      }
    }
  }
  if ((toolName === 'ImageGen' || toolName === 'ImageEdit') && Array.isArray(content)) {
    for (const item of content) {
      if (item && typeof item === 'object' && item.type === 'content' && item.content?.type === 'image') {
        const uri = typeof (item.content as { uri?: unknown }).uri === 'string' ? stripFileUri((item.content as { uri: string }).uri) : ''
        if (uri) {
          return JSON.stringify({
            status: 'generated',
            savedPaths: [uri],
            provider: 'antigravity',
          })
        }
      }
    }
  }
  return null
}

export function toolResultFromUpdate(update: ToolCallUpdate, terminalOutput?: string): ContentBlock | null {
  if (update.status !== 'completed' && update.status !== 'failed') return null

  const toolName = normalizeAcpTool(update)?.toolName

  if (update.status === 'completed') {
    const gallery = mediaGenGallerySummary(update.rawOutput, update.content, toolName)
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
      const gallery =
        mediaGenGallerySummary(
          (() => {
            try { return JSON.parse(typeof text === 'string' ? text : '') } catch { return null }
          })(),
        )
        ?? (typeof text === 'string' ? mediaGenGallerySummary(text) : null)
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
  const capped = shouldKeepFullToolResult(summary, toolName) ? summary : summary.slice(0, 4000)
  const failed = update.status === 'failed'
  const text = withGrokAutoDenyPrefix(capped || (failed ? 'failed' : 'done'), failed)
  const outputPath = backgroundTaskOutputPath(update.rawOutput)
  return {
    type: 'tool_result',
    toolUseId: update.toolCallId,
    summary: text,
    ...(outputPath ? { outputPath } : {}),
    isError: failed,
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
  if (toolName && FULL_RESULT_TOOL_NAMES.has(toolName)) return true
  if (isCollabToolName(toolName)) return true
  if (isSessionArchiveToolName(toolName)) return true
  if (looksLikeSessionArchiveToon(summary)) return true
  if (isComputerUseToolName(toolName)) return true
  if (looksLikeComputerUseOutline(summary)) return true
  if (isJevRunToolName(toolName)) return true
  const trimmed = summary.trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>
    return (typeof obj.widget_code === 'string' && obj.widget_code.length > 0)
      // A native widget_show result *is* the UI (gallery items, previewer rows); truncating it
      // leaves the renderer with unparseable JSON and a blank turn.
      || (obj.kind === 'native' && typeof obj.nativeType === 'string')
      || looksLikeCollabResult(obj)
      || looksLikeSessionArchiveJson(obj)
      || looksLikeComputerUseResult(obj)
      || looksLikeJevRunResult(obj)
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
