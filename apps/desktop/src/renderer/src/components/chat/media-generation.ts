import type { ImageGenerationItem, VideoGenerationItem, CodexThreadItem } from '@superone/shared/agent-types'

const MEDIA_GENERATE_IMAGE_TOOL = 'mcp__superone__media_generate_image'
const MEDIA_GENERATE_VIDEO_TOOL = 'mcp__superone__media_generate_video'
const MEDIA_VIDEO_STATUS_TOOL = 'mcp__superone__media_video_status'

interface GenerationResult {
  status?: string
  savedPaths?: unknown
  provider?: unknown
  model?: unknown
  warnings?: unknown
  generationId?: unknown
}

export function isMediaGenerateImageTool(toolName: string): boolean {
  return toolName === MEDIA_GENERATE_IMAGE_TOOL
}

export function isMediaGenerateVideoTool(toolName: string): boolean {
  return toolName === MEDIA_GENERATE_VIDEO_TOOL
}

export function isMediaVideoStatusTool(toolName: string): boolean {
  return toolName === MEDIA_VIDEO_STATUS_TOOL
}

function parseGenerationResult(resultText: string | undefined): GenerationResult | null {
  if (!resultText) return null
  try {
    return JSON.parse(resultText) as GenerationResult
  } catch {
    return null
  }
}

function toSavedPaths(parsed: GenerationResult): string[] {
  return Array.isArray(parsed.savedPaths)
    ? parsed.savedPaths.filter((p): p is string => typeof p === 'string')
    : []
}

export function isSuccessfulGenerationResult(resultText: string | undefined): boolean {
  const parsed = parseGenerationResult(resultText)
  if (!parsed || parsed.status === 'error') return false
  return toSavedPaths(parsed).length > 0
}

export function isFailedGenerationResult(resultText: string | undefined): boolean {
  return parseGenerationResult(resultText)?.status === 'error'
}

/** A status poll that reports the job is still rendering — nothing new to show yet. */
export function isVideoStatusStillRunning(resultText: string | undefined): boolean {
  return parseGenerationResult(resultText)?.status === 'running'
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

  return toSavedPaths(parsed).map((savedPath, idx) => ({
    id: `${id}-${idx}`,
    type: 'image_generation',
    status: 'completed',
    savedPath,
    revisedPrompt,
    ...(referenceImagePaths ? { referenceImagePaths } : {}),
    ...(params.length > 0 ? { params } : {}),
    ...(warnings && warnings.length > 0 ? { warnings } : {}),
  }))
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

function codexMcpResultText(item: Extract<CodexThreadItem, { type: 'mcp_tool_call' }>): string | undefined {
  const content = item.result?.content as Array<{ type: string; text: string }> | undefined
  const textParts = content?.filter((c) => c.type === 'text').map((c) => c.text)
  return textParts?.length ? textParts.join('\n') : undefined
}

export function collectCodexGeneratedImages(codexItems: CodexThreadItem[] | undefined): ImageGenerationItem[] {
  const items: ImageGenerationItem[] = []
  for (const item of codexItems ?? []) {
    if (item.type !== 'mcp_tool_call') continue
    if (!isMediaGenerateImageTool(`mcp__${item.server}__${item.tool}`) || item.error) continue
    items.push(...toImageGenerationItems(item.id, item.arguments, codexMcpResultText(item)))
  }
  return items
}

/** Codex counterpart of collectGeneratedVideos — same completing-poll-only contract. */
export function collectCodexGeneratedVideos(codexItems: CodexThreadItem[] | undefined): VideoGenerationItem[] {
  const byId = new Map<string, VideoGenerationItem>()
  for (const item of codexItems ?? []) {
    if (item.type !== 'mcp_tool_call') continue
    if (!isMediaVideoStatusTool(`mcp__${item.server}__${item.tool}`) || item.error) continue
    for (const video of toVideoStatusItems(codexMcpResultText(item))) byId.set(video.id, video)
  }
  return [...byId.values()]
}
