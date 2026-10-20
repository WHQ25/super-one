import type { ChatMessage, ImageGenerationItem, VideoGenerationItem, CodexThreadItem } from '@superone/shared/agent-types'
import { isMediaGenerateVideoTool, isMediaVideoStatusTool } from '@superone/chat-core'
import { parseGenerationResult, toSavedPaths, type GenerationResult } from '@superone/chat-core/turn-process/media-tools'

export { isMediaGenerateVideoTool, isMediaVideoStatusTool }
export {
  isFailedGenerationResult,
  isGrokVideoGenTool,
  isMediaGenerateImageTool,
  isSuccessfulGenerationResult,
  isVideoStatusStillRunning,
  isWidgetShowTool,
  nativeWidgetImages,
  nativeWidgetVideos,
} from '@superone/chat-core/turn-process/media-tools'

/** Pull the human error string from a media_generate_* / status JSON (or `[Error]` text). */
export function mediaToolErrorMessage(result?: string | null): string {
  if (!result) return ''
  try {
    const parsed = JSON.parse(result) as { message?: unknown; error?: unknown }
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim()
      if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim()
    }
  } catch { /* not JSON */ }
  return result.replace(/^\[Error\]\s*/i, '').trim()
}

export function isMediaToolErrorResult(result?: string | null, isError?: boolean): boolean {
  if (isError) return true
  if (!result) return false
  try {
    const parsed = JSON.parse(result) as { status?: unknown }
    return parsed?.status === 'error'
  } catch {
    return /^\[Error\]/i.test(result)
  }
}

function toPreviewPaths(parsed: GenerationResult, savedPaths: string[]): (string | undefined)[] {
  const raw = Array.isArray(parsed.previewPaths)
    ? parsed.previewPaths.filter((p): p is string => typeof p === 'string')
    : []
  return savedPaths.map((_, idx) => raw[idx])
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string' && p.trim().length > 0) : []
}

function toReferenceImagePaths(input: Record<string, unknown> | undefined): string[] | undefined {
  const paths = toStringList(input?.reference_image_paths)
  return paths.length > 0 ? paths : undefined
}

/** Label shown in the card, paired with the tool-input key it reads from. */
type ParamKeys = [label: string, inputKey: string][]

const IMAGE_PARAM_KEYS: ParamKeys = [
  ['size', 'size'],
  ['aspectRatio', 'aspect_ratio'],
]

function buildGenerationParams(
  input: Record<string, unknown> | undefined,
  result: GenerationResult,
  extraKeys: ParamKeys = IMAGE_PARAM_KEYS,
): { key: string; value: string }[] {
  const params: { key: string; value: string }[] = []
  const push = (key: string, value: unknown) => {
    if (typeof value === 'string' && value.trim()) params.push({ key, value: value.trim() })
    else if (typeof value === 'number') params.push({ key, value: String(value) })
  }
  push('provider', result.provider ?? input?.provider)
  push('model', result.model ?? input?.model)
  for (const [label, inputKey] of extraKeys) push(label, input?.[inputKey])
  return params
}

export function toImageGenerationItems(
  id: string,
  input: unknown,
  resultText: string | undefined,
): ImageGenerationItem[] {
  const record = toRecord(input)
  const rawPrompt = record?.prompt
  const revisedPrompt = typeof rawPrompt === 'string' ? rawPrompt : undefined
  const referenceImagePaths = toReferenceImagePaths(record)

  if (!resultText) {
    const params = buildGenerationParams(record, {})
    return [{
      id,
      type: 'image_generation',
      status: 'in_progress',
      revisedPrompt,
      ...(referenceImagePaths ? { referenceImagePaths } : {}),
      ...(params.length > 0 ? { params } : {}),
    }]
  }

  const parsed = parseGenerationResult(resultText)
  if (!parsed || parsed.status === 'error') return []

  const params = buildGenerationParams(record, parsed)
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.map((w) => (typeof w === 'string' ? w : JSON.stringify(w))).filter(Boolean)
    : undefined

  const savedPaths = toSavedPaths(parsed)
  const previewPaths = toPreviewPaths(parsed, savedPaths)

  return savedPaths.map((savedPath, idx) => {
    const previewPath = previewPaths[idx]
    return {
      id: `${id}-${idx}`,
      type: 'image_generation',
      status: 'completed' as const,
      savedPath,
      ...(previewPath && previewPath !== savedPath ? { previewPath } : {}),
      revisedPrompt,
      ...(referenceImagePaths ? { referenceImagePaths } : {}),
      ...(params.length > 0 ? { params } : {}),
      ...(warnings && warnings.length > 0 ? { warnings } : {}),
    }
  })
}

/**
 * Map a completed `media_video_status` poll onto the finished card.
 *
 * Returns nothing while the job is still running so the placeholder from the submit call stays put
 * rather than being replaced by a second, identical in-progress card.
 */
export function toVideoStatusItems(resultText: string | undefined): VideoGenerationItem[] {
  const parsed = parseGenerationResult(resultText)
  if (!parsed || parsed.status !== 'generated') return []

  const generationId = typeof parsed.generationId === 'string' ? parsed.generationId : undefined
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.map((w) => (typeof w === 'string' ? w : JSON.stringify(w))).filter(Boolean)
    : undefined

  // The id deliberately matches the placeholder's so the finished card replaces it rather than
  // appearing next to it. A generation yields exactly one video, so no index suffix is needed.
  return toSavedPaths(parsed).map((savedPath) => ({
    id: generationId ?? savedPath,
    type: 'video_generation',
    status: 'completed',
    savedPath,
    ...(warnings && warnings.length > 0 ? { warnings } : {}),
  }))
}

export interface VideoGenStatusSnapshot {
  status: string
  generationId: string
  prompt?: string
  provider?: string
  model?: string
  savedPaths?: string[]
  warnings?: string[]
  error?: string
}

/**
 * Rebuild the live video-status map from persisted tool results.
 * `videoGenStatuses` is not written to SQLite — without this, a cold restore
 * shows every submit as "Submitted" even after the completing poll landed.
 */
export function videoGenStatusesFromMessages(
  messages: Array<Pick<ChatMessage, 'content'>>,
): Record<string, VideoGenStatusSnapshot> {
  const statuses: Record<string, VideoGenStatusSnapshot> = {}

  const applySubmit = (inputRaw: string | undefined, resultRaw: string | undefined) => {
    try {
      const result = JSON.parse(resultRaw ?? '{}') as Record<string, unknown>
      const genId = result.generationId
      if (typeof genId !== 'string' || !genId) return
      const input = inputRaw ? JSON.parse(inputRaw) as Record<string, unknown> : {}
      const prev = statuses[genId]
      statuses[genId] = {
        status: result.status === 'error' ? 'error' : (prev?.status ?? 'submitted'),
        generationId: genId,
        prompt: typeof input.prompt === 'string' ? input.prompt : prev?.prompt,
        provider: typeof input.provider === 'string' ? input.provider : prev?.provider,
        model: typeof input.model === 'string' ? input.model : prev?.model,
        savedPaths: Array.isArray(result.savedPaths) ? result.savedPaths.filter((p): p is string => typeof p === 'string') : prev?.savedPaths,
        warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : prev?.warnings,
        error: result.status === 'error' ? String(result.message ?? '') : prev?.error,
      }
    } catch { /* ignore malformed JSON */ }
  }

  const applyStatus = (inputRaw: string | undefined, resultRaw: string | undefined) => {
    try {
      const input = inputRaw ? JSON.parse(inputRaw) as Record<string, unknown> : {}
      const genId = input.generation_id
      if (typeof genId !== 'string' || !genId) return
      const result = JSON.parse(resultRaw ?? '{}') as Record<string, unknown>
      const prev = statuses[genId]
      statuses[genId] = {
        ...(prev ?? { status: 'running', generationId: genId }),
        status: result.status === 'error' ? 'error' : (result.status === 'generated' ? 'generated' : 'running'),
        savedPaths: Array.isArray(result.savedPaths) ? result.savedPaths.filter((p): p is string => typeof p === 'string') : prev?.savedPaths,
        warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : prev?.warnings,
        error: result.status === 'error' ? String(result.message ?? '') : prev?.error,
      }
    } catch { /* ignore malformed JSON */ }
  }

  for (const msg of messages) {
    const resultById = new Map<string, string>()
    const tools: Array<{ id: string; name: string; input: string }> = []
    for (const block of msg.content ?? []) {
      if (block.type === 'tool_result' && block.toolUseId && block.summary) {
        resultById.set(block.toolUseId, block.summary)
      }
      if (block.type === 'tool_use' && block.toolUseId && typeof block.input === 'string') {
        tools.push({ id: block.toolUseId, name: block.toolName, input: block.input })
      }
    }
    for (const tool of tools) {
      if (isMediaGenerateVideoTool(tool.name)) applySubmit(tool.input, resultById.get(tool.id))
      if (isMediaVideoStatusTool(tool.name)) applyStatus(tool.input, resultById.get(tool.id))
    }
  }

  return statuses
}
