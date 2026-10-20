import type { ImageGenerationItem, VideoGenerationItem } from '@superone/shared/agent-types'
import { CODEX_AGENT_WAIT_TOOL, CODEX_IMAGE_GENERATION_TOOL } from '@superone/shared/codex-content'
import { parseNativeWidgetResult } from '@superone/shared/generative-ui/native-widgets'
import { isAlwaysHiddenToolName } from '@superone/shared/tool-ui'
import { isMediaGenerateVideoTool, isMediaVideoStatusTool } from '../media-predicates'

const MEDIA_GENERATE_IMAGE_TOOL = 'mcp__superone__media_generate_image'
const WIDGET_SHOW_TOOL = 'mcp__superone__widget_show'

/** Grok Build native Imagine tools (ACP title / resolved toolName). */
const GROK_IMAGE_GEN_TOOLS = new Set(['ImageGen', 'ImageEdit', 'image_gen', 'image_edit'])
const GROK_VIDEO_GEN_TOOLS = new Set([
  'ImageToVideo',
  'ReferenceToVideo',
  'image_to_video',
  'reference_to_video',
])
const GROK_MEDIA_OUTPUT_TYPES = new Set(['ImageGen', 'ImageEdit', 'ImageToVideo', 'ReferenceToVideo'])

export interface GenerationResult {
  status?: string
  savedPaths?: unknown
  /** Parallel to savedPaths — downscaled previews for thumbs / agent Read. */
  previewPaths?: unknown
  provider?: unknown
  model?: unknown
  warnings?: unknown
  generationId?: unknown
  /** Grok MediaGenOutput / prompt_text shape */
  path?: unknown
  type?: unknown
}

export function isMediaGenerateImageTool(toolName: string): boolean {
  return toolName === MEDIA_GENERATE_IMAGE_TOOL || GROK_IMAGE_GEN_TOOLS.has(toolName)
}

/** Grok native video tools return a finished path (no SuperOne status poll). */
export function isGrokVideoGenTool(toolName: string): boolean {
  return GROK_VIDEO_GEN_TOOLS.has(toolName)
}

export function isWidgetShowTool(toolName: string): boolean {
  return toolName === WIDGET_SHOW_TOOL
}

/**
 * `widget_show({ template: '@native/…' })` renders one of SuperOne's own surfaces rather than a
 * frame, so its items belong to the same turn-end gallery a built-in generation feeds.
 *
 * These two readers and `isHiddenToolBlock` all go through `parseNativeWidgetResult`, which is what
 * keeps the hide contract honest: a row is hidden if and only if one of these returns something.
 */
export function nativeWidgetImages(resultText: string | undefined): ImageGenerationItem[] {
  return parseNativeWidgetResult(resultText)?.images ?? []
}

export function nativeWidgetVideos(resultText: string | undefined): VideoGenerationItem[] {
  return parseNativeWidgetResult(resultText)?.videos ?? []
}

/**
 * Normalize SuperOne media_generate_* JSON and Grok MediaGenOutput / prompt_text JSON
 * into the shared GenerationResult shape the gallery mapper expects.
 */
function coerceGenerationResult(parsed: GenerationResult): GenerationResult | null {
  const saved = toSavedPaths(parsed)
  if (saved.length > 0) {
    return {
      ...parsed,
      status: parsed.status === 'error' ? 'error' : (parsed.status ?? 'generated'),
      savedPaths: saved,
    }
  }
  // Grok typed output: { type: "ImageGen", path, filename, session_folder }
  // or prompt_text JSON: { path, filename, session_folder, message }
  const path = typeof parsed.path === 'string' ? parsed.path.trim() : ''
  if (path) {
    const type = typeof parsed.type === 'string' ? parsed.type : undefined
    if (type && !GROK_MEDIA_OUTPUT_TYPES.has(type)) {
      // Unknown typed payload with a path field — only accept image/video-looking paths.
      if (!/\.(png|jpe?g|gif|webp|bmp|mp4|webm|mov)$/i.test(path) && !path.includes('/images/')) {
        return parsed
      }
    }
    return {
      status: 'generated',
      savedPaths: [path],
      provider: parsed.provider ?? 'grok',
      model: parsed.model,
      warnings: parsed.warnings,
      generationId: parsed.generationId,
    }
  }
  // SuperOne video status polls (`running` / `error` / `generated` without paths yet)
  // and plain error objects must pass through unchanged.
  return parsed
}

export function parseGenerationResult(resultText: string | undefined): GenerationResult | null {
  if (!resultText) return null
  try {
    const parsed = JSON.parse(resultText) as GenerationResult
    if (!parsed || typeof parsed !== 'object') return null
    return coerceGenerationResult(parsed)
  } catch {
    return null
  }
}

export function toSavedPaths(parsed: GenerationResult): string[] {
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

export function isHiddenToolBlock(toolName: string, result?: string): boolean {
  if (isAlwaysHiddenToolName(toolName)) return true
  // Waiting on agents is only news while it lasts; their cards carry the outcome.
  if (toolName === CODEX_AGENT_WAIT_TOOL) return result !== undefined
  // A native-template widget_show *is* the gallery, so its row would only narrate what the user can
  // already see. A code widget, a still-streaming call, and a failed build all keep their row —
  // this reads the same parse the gallery collects from, so the two cannot disagree.
  if (isWidgetShowTool(toolName)) return nativeWidgetImages(result).length > 0 || nativeWidgetVideos(result).length > 0
  if (isMediaGenerateImageTool(toolName)) return !result || isSuccessfulGenerationResult(result)
  // Grok native video is synchronous (path on complete) — hide the tool row when the gallery
  // will render the file, same as ImageGen.
  if (isGrokVideoGenTool(toolName)) return !result || isSuccessfulGenerationResult(result)
  // The submit block stays visible: it is the only progress affordance during the minutes a video
  // renders, and the gallery card cannot stand in for it because the completing poll usually lands
  // in a later message. Polls are hidden while running (pure noise) and on success (the gallery
  // shows the video); a failed poll keeps its block so the error is visible.
  if (isMediaVideoStatusTool(toolName)) {
    return !result || isVideoStatusStillRunning(result) || isSuccessfulGenerationResult(result)
  }
  return false
}

/**
 * Calls the turn-end galleries read (`collectGeneratedImages` / `collectGeneratedVideos`), and the
 * submit whose card stands in until its poll lands. A transcript window keeps them in place.
 */
export function isTurnGallerySourceTool(toolName: string): boolean {
  return toolName === CODEX_IMAGE_GENERATION_TOOL
    || isWidgetShowTool(toolName)
    || isMediaGenerateImageTool(toolName)
    || isMediaGenerateVideoTool(toolName)
    || isMediaVideoStatusTool(toolName)
    || isGrokVideoGenTool(toolName)
}
