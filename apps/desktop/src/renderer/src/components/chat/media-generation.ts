import type { ImageGenerationItem, CodexThreadItem } from '@superone/shared/agent-types'

const MEDIA_GENERATE_IMAGE_TOOL = 'mcp__superone__media_generate_image'

interface GenerationResult {
  status?: string
  savedPaths?: unknown
  provider?: unknown
  model?: unknown
  warnings?: unknown
}

export function isMediaGenerateImageTool(toolName: string): boolean {
  return toolName === MEDIA_GENERATE_IMAGE_TOOL
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

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function toReferenceImagePaths(input: Record<string, unknown> | undefined): string[] | undefined {
  const refs = input?.reference_image_paths
  if (!Array.isArray(refs)) return undefined
  const paths = refs.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
  return paths.length > 0 ? paths : undefined
}

function buildGenerationParams(
  input: Record<string, unknown> | undefined,
  result: GenerationResult,
): { key: string; value: string }[] {
  const params: { key: string; value: string }[] = []
  const push = (key: string, value: unknown) => {
    if (typeof value === 'string' && value.trim()) params.push({ key, value: value.trim() })
    else if (typeof value === 'number') params.push({ key, value: String(value) })
  }
  push('provider', result.provider ?? input?.provider)
  push('model', result.model ?? input?.model)
  push('size', input?.size)
  push('aspectRatio', input?.aspect_ratio)
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

export function collectCodexGeneratedImages(codexItems: CodexThreadItem[] | undefined): ImageGenerationItem[] {
  const items: ImageGenerationItem[] = []
  for (const item of codexItems ?? []) {
    if (item.type !== 'mcp_tool_call') continue
    if (!isMediaGenerateImageTool(`mcp__${item.server}__${item.tool}`) || item.error) continue
    const content = item.result?.content as Array<{ type: string; text: string }> | undefined
    const textParts = content?.filter((c) => c.type === 'text').map((c) => c.text)
    items.push(...toImageGenerationItems(item.id, item.arguments, textParts?.length ? textParts.join('\n') : undefined))
  }
  return items
}
