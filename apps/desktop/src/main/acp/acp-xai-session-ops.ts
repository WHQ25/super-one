/**
 * Grok client→agent session ops and agent→client interjection paint.
 *
 * Wire (camelCase, `_` prefix on the way out — see `xaiExtWireMethod`):
 *   x.ai/interject
 *   x.ai/session/interjection
 *   x.ai/compact_conversation
 *   x.ai/rewind/{points,execute}
 *   x.ai/session/fork
 */
import type { ChatMessage, ImageAttachment, RewindFilesResult } from '@superone/shared/agent-types'

export const XAI_INTERJECT = 'x.ai/interject'
export const XAI_SESSION_INTERJECTION = 'x.ai/session/interjection'
export const XAI_COMPACT_CONVERSATION = 'x.ai/compact_conversation'
export const XAI_REWIND_POINTS = 'x.ai/rewind/points'
export const XAI_REWIND_EXECUTE = 'x.ai/rewind/execute'
export const XAI_SESSION_FORK = 'x.ai/session/fork'

export type GrokRewindMode = 'all' | 'conversation_only' | 'files_only'

export interface GrokInterjectParams {
  sessionId: string
  text: string
  interjectionId?: string
  content?: unknown[]
}

export interface GrokSessionInterjection {
  sessionId?: string
  text: string
  interjectionId?: string
}

export interface GrokRewindPoint {
  promptIndex: number
  hasFileChanges: boolean
  numFileSnapshots: number
  promptPreview?: string
}

export interface GrokRewindExecuteResult {
  success: boolean
  mode: GrokRewindMode
  revertedFiles: string[]
  cleanFiles: string[]
  conflicts: Array<{ path: string; conflictType: string }>
  error?: string
  promptText?: string
}

export interface GrokForkParams {
  sourceSessionId: string
  sourceCwd: string
  newCwd: string
  newSessionId?: string
  targetPromptIndex?: number
  sessionKind?: string
  sourceWorkspaceDir?: string
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function strField(o: Record<string, unknown>, camel: string, snake: string): string | undefined {
  const a = o[camel]
  if (typeof a === 'string' && a.trim()) return a.trim()
  const b = o[snake]
  if (typeof b === 'string' && b.trim()) return b.trim()
  return undefined
}

function numField(o: Record<string, unknown>, camel: string, snake: string): number | undefined {
  const a = o[camel]
  if (typeof a === 'number' && Number.isFinite(a)) return a
  const b = o[snake]
  if (typeof b === 'number' && Number.isFinite(b)) return b
  return undefined
}

function boolField(o: Record<string, unknown>, camel: string, snake: string): boolean | undefined {
  const a = o[camel]
  if (typeof a === 'boolean') return a
  const b = o[snake]
  if (typeof b === 'boolean') return b
  return undefined
}

/** ACP SDK may return the result body or `{ result, error }`. */
export function unwrapAcpExtResult(raw: unknown): Record<string, unknown> | null {
  const o = asRecord(raw)
  if (!o) return null
  if (o.error != null && o.error !== false) return o
  const nested = asRecord(o.result)
  return nested ?? o
}

export function parseGrokCompactSlash(content: string): { userContext?: string } | null {
  const match = content.trim().match(/^\/compact(?:\s+([\s\S]+))?$/)
  if (!match) return null
  const userContext = match[1]?.trim()
  return userContext ? { userContext } : {}
}

/**
 * Grok parses `/goal` only as the first token of a new `session/prompt`.
 * Mid-turn follow-ups are parked for `x.ai/interject`, which never hits that
 * parser — so a live goal turn must be cancelled and this line sent as its
 * own prompt (`pause` / `clear` / a replacement objective).
 */
export function isGrokGoalSlash(content: string): boolean {
  return /^\/goal(?:\s|$)/i.test(content.trim())
}

export function parseGrokSessionInterjection(raw: unknown): GrokSessionInterjection | null {
  const o = asRecord(raw)
  if (!o) return null
  const text = strField(o, 'text', 'text')
  if (!text) return null
  return {
    text,
    ...(strField(o, 'sessionId', 'session_id') ? { sessionId: strField(o, 'sessionId', 'session_id') } : {}),
    ...(strField(o, 'interjectionId', 'interjection_id')
      ? { interjectionId: strField(o, 'interjectionId', 'interjection_id') }
      : {}),
  }
}

export function buildGrokInterjectParams(
  sessionId: string,
  text: string,
  interjectionId?: string,
  images?: ImageAttachment[],
): GrokInterjectParams {
  const params: GrokInterjectParams = { sessionId, text }
  if (interjectionId) params.interjectionId = interjectionId
  const content: unknown[] = []
  if (text.trim()) content.push({ type: 'text', text })
  for (const image of images ?? []) {
    if (!image.base64 || !image.mimeType) continue
    content.push({ type: 'image', data: image.base64, mimeType: image.mimeType })
  }
  if (content.length > 1) params.content = content
  return params
}

export function parseGrokRewindPoints(raw: unknown): GrokRewindPoint[] {
  const o = unwrapAcpExtResult(raw)
  if (!o) return []
  const list = o.rewindPoints ?? o.rewind_points
  if (!Array.isArray(list)) return []
  const out: GrokRewindPoint[] = []
  for (const item of list) {
    const p = asRecord(item)
    if (!p) continue
    const promptIndex = numField(p, 'promptIndex', 'prompt_index')
    if (promptIndex == null || promptIndex < 0) continue
    out.push({
      promptIndex,
      hasFileChanges: boolField(p, 'hasFileChanges', 'has_file_changes') === true,
      numFileSnapshots: Math.max(0, Math.trunc(numField(p, 'numFileSnapshots', 'num_file_snapshots') ?? 0)),
      ...(strField(p, 'promptPreview', 'prompt_preview')
        ? { promptPreview: strField(p, 'promptPreview', 'prompt_preview') }
        : {}),
    })
  }
  return out
}

function parseRewindMode(raw: unknown): GrokRewindMode {
  if (raw === 'conversation_only' || raw === 'files_only' || raw === 'all') return raw
  if (raw === 'code_only') return 'files_only'
  return 'all'
}

export function parseGrokRewindExecute(raw: unknown): GrokRewindExecuteResult {
  const o = unwrapAcpExtResult(raw)
  if (!o) {
    return { success: false, mode: 'all', revertedFiles: [], cleanFiles: [], conflicts: [], error: 'empty rewind response' }
  }
  if (o.error != null && typeof o.error === 'object' && !('success' in o)) {
    const err = asRecord(o.error)
    const message = err ? strField(err, 'message', 'data') ?? JSON.stringify(o.error) : String(o.error)
    return { success: false, mode: 'all', revertedFiles: [], cleanFiles: [], conflicts: [], error: message }
  }
  const reverted = Array.isArray(o.revertedFiles) ? o.revertedFiles : Array.isArray(o.reverted_files) ? o.reverted_files : []
  const clean = Array.isArray(o.cleanFiles) ? o.cleanFiles : Array.isArray(o.clean_files) ? o.clean_files : []
  const conflictsRaw = Array.isArray(o.conflicts) ? o.conflicts : []
  const conflicts: Array<{ path: string; conflictType: string }> = []
  for (const item of conflictsRaw) {
    const c = asRecord(item)
    if (!c) continue
    const path = strField(c, 'path', 'path')
    if (!path) continue
    conflicts.push({
      path,
      conflictType: strField(c, 'conflictType', 'conflict_type') ?? 'unknown',
    })
  }
  const error = typeof o.error === 'string' && o.error.trim() ? o.error.trim() : undefined
  return {
    success: o.success === true,
    mode: parseRewindMode(o.mode),
    revertedFiles: reverted.filter((p): p is string => typeof p === 'string' && p.length > 0),
    cleanFiles: clean.filter((p): p is string => typeof p === 'string' && p.length > 0),
    conflicts,
    ...(error ? { error } : {}),
    ...(strField(o, 'promptText', 'prompt_text') ? { promptText: strField(o, 'promptText', 'prompt_text') } : {}),
  }
}

export function rewindPreviewFromPoints(points: GrokRewindPoint[], promptIndex: number): RewindFilesResult {
  const point = points.find((p) => p.promptIndex === promptIndex)
  if (!point) {
    return { canRewind: false, error: `No Grok rewind point at prompt ${promptIndex}` }
  }
  const n = point.hasFileChanges ? Math.max(1, point.numFileSnapshots) : 0
  return {
    canRewind: true,
    supportsCodeOnly: true,
    filesChanged: n > 0 ? Array.from({ length: n }, (_, i) => `file-${i + 1}`) : [],
  }
}

export function rewindResultFromExecute(result: GrokRewindExecuteResult): RewindFilesResult {
  if (!result.success) {
    const conflictNote = result.conflicts.length > 0
      ? result.conflicts.map((c) => `${c.path} (${c.conflictType})`).join(', ')
      : undefined
    return {
      canRewind: false,
      supportsCodeOnly: true,
      error: result.error ?? conflictNote ?? 'Grok rewind failed',
      filesChanged: result.conflicts.map((c) => c.path),
    }
  }
  return {
    canRewind: true,
    supportsCodeOnly: true,
    filesChanged: result.revertedFiles.length > 0 ? result.revertedFiles : result.cleanFiles,
  }
}

/**
 * Grok's 0-based user-prompt index. SuperOne stamps `checkpointId` on each
 * user message that actually became `session/prompt` (not interject / compact).
 */
export function grokPromptIndexForUserMessage(
  messages: ChatMessage[],
  userMessageId: string,
): number | null {
  const prompts = messages.filter((m) => m.role === 'user' && m.checkpointId)
  const idx = prompts.findIndex((m) => m.checkpointId === userMessageId || m.id === userMessageId)
  return idx >= 0 ? idx : null
}

/**
 * `x.ai/session/fork` `targetPromptIndex` drops that prompt and everything
 * after it. Passing N+1 keeps prompts 0..N (the selected turn inclusive).
 */
export function grokForkTargetPromptIndex(
  messages: ChatMessage[],
  forkFromMessageId: string,
): number | undefined {
  const idx = messages.findIndex((m) => m.id === forkFromMessageId)
  if (idx < 0) return undefined
  let count = 0
  for (let i = 0; i <= idx; i++) {
    const m = messages[i]
    if (m.role === 'user' && m.checkpointId) count++
  }
  return count > 0 ? count : undefined
}

export function parseGrokForkResponse(raw: unknown): { newSessionId: string } {
  const o = unwrapAcpExtResult(raw)
  if (!o) throw new Error('empty fork response')
  if (o.error != null && typeof o.error === 'object' && !strField(o, 'newSessionId', 'new_session_id')) {
    const err = asRecord(o.error)
    throw new Error(err ? strField(err, 'message', 'data') ?? JSON.stringify(o.error) : String(o.error))
  }
  if (typeof o.error === 'string' && o.error.trim() && !strField(o, 'newSessionId', 'new_session_id')) {
    throw new Error(o.error.trim())
  }
  const id = strField(o, 'newSessionId', 'new_session_id')
  if (!id) throw new Error('fork response missing newSessionId')
  return { newSessionId: id }
}

export function buildGrokForkParams(input: GrokForkParams): Record<string, unknown> {
  const params: Record<string, unknown> = {
    sourceSessionId: input.sourceSessionId,
    sourceCwd: input.sourceCwd,
    newCwd: input.newCwd,
    sessionKind: input.sessionKind ?? 'fork',
  }
  if (input.newSessionId) params.newSessionId = input.newSessionId
  if (input.targetPromptIndex != null) params.targetPromptIndex = input.targetPromptIndex
  if (input.sourceWorkspaceDir) params.sourceWorkspaceDir = input.sourceWorkspaceDir
  return params
}
