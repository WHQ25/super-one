/**
 * Host side of `widget_show({ template: '@native/…' })`.
 *
 * A code widget is handed straight to the frame, but a native one has to be *prepared*: the agent
 * holds bytes (it just called some provider's HTTP API), while the galleries render files from disk
 * so the viewer, download, and drag-to-Finder affordances work. Turning those bytes into the same
 * on-disk shape a built-in generation produces is what makes an agent-authored adapter
 * indistinguishable from `media_generate_image` downstream.
 *
 * Errors here are deliberate and loud. An empty or unresolvable gallery must never reach the
 * renderer: the tool row hides itself whenever a native payload parses, so a payload with nothing
 * renderable in it would erase the call from the transcript entirely.
 */
import { existsSync } from 'fs'
import type { ImageGenerationItem, VideoGenerationItem } from '@superone/shared/agent-types'
import type { NativeWidgetPayload, NativeWidgetType } from '@superone/shared/generative-ui/native-widgets'
import { attachImagePreviews, type ImagePreviewDeps } from '../media-gen/image-preview'
import { persistImages, persistVideos, type PersistableFile } from '../media-gen/storage'
import type { SavedImage } from '../media-gen/types'

/**
 * Agent-facing catalog. `widget_list_templates` prints this next to the saved templates so the
 * native surfaces are discovered the same way a saved one is — the tool description only has to
 * say the namespace exists.
 */
export const NATIVE_TEMPLATE_CATALOG: { id: string; type: NativeWidgetType; description: string }[] = [
  {
    id: '@native/image-gallery',
    type: 'image-gallery',
    description:
      'SuperOne\'s own image gallery — the surface media_generate_image renders into (viewer, download, drag to Finder). '
      + 'data: { images: [{ path } | { base64, mediaType }], prompt?, params?: { [label]: string | number }, warnings?: string[] }. '
      + 'Use this for images you produced yourself (a custom provider, a script) instead of rebuilding a gallery in widget_code.',
  },
  {
    id: '@native/video-gallery',
    type: 'video-gallery',
    description:
      'SuperOne\'s own video gallery — the surface finished media_generate_video jobs render into. '
      + 'data: { videos: [{ path } | { base64, mediaType }], prompt?, params?: { [label]: string | number }, warnings?: string[] }.',
  },
]

export function formatNativeTemplateList(): string {
  const lines = NATIVE_TEMPLATE_CATALOG.map(({ id, description }) => `- \`${id}\` — ${description}`)
  return `# Built-in native templates\n\nThese render SuperOne's own UI instead of HTML in a frame. `
    + `Pass one as \`widget_show({ template })\`; the tool row is replaced by the native surface itself.\n\n${lines.join('\n')}`
}

export interface NativeWidgetBuildDeps {
  /** Where agent-supplied bytes land — normally `mediaGenOutputDir(sessionId)`. */
  outputDir: string
  generationId: string
  previewDeps?: ImagePreviewDeps
  fileExists?: (path: string) => boolean
}

export interface BuiltNativeWidgetPayload {
  payload?: NativeWidgetPayload
  error?: string
}

/** One entry as the agent writes it: either a file it already has, or bytes it just fetched. */
interface MediaEntryInput {
  path?: unknown
  base64?: unknown
  mediaType?: unknown
}

type ResolvedEntry = { kind: 'path'; path: string } | { kind: 'bytes'; file: PersistableFile }

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function toParams(value: unknown): { key: string; value: string }[] {
  const record = asRecord(value)
  if (!record) return []
  const params: { key: string; value: string }[] = []
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === 'string' && raw.trim()) params.push({ key, value: raw.trim() })
    else if (typeof raw === 'number' && Number.isFinite(raw)) params.push({ key, value: String(raw) })
  }
  return params
}

function toWarnings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const warnings = value.filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
  return warnings.length > 0 ? warnings : undefined
}

/**
 * Resolve every entry before writing anything, so a bad entry halfway through the list does not
 * leave orphaned files behind from the ones that came first.
 */
function resolveEntries(
  entries: unknown,
  field: string,
  fileExists: (path: string) => boolean,
): { resolved?: ResolvedEntry[]; error?: string } {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { error: `[Error] widget_show with this native template requires a non-empty \`data.${field}\` array, where each entry is { path } for a file already on disk or { base64, mediaType } for bytes you just fetched.` }
  }

  const resolved: ResolvedEntry[] = []
  for (const [index, raw] of entries.entries()) {
    const entry = (asRecord(raw) ?? {}) as MediaEntryInput
    const at = `${field}[${index}]`

    if (typeof entry.path === 'string' && entry.path.trim()) {
      const path = entry.path.trim()
      if (!fileExists(path)) return { error: `[Error] ${at} points at a file that does not exist: ${path}` }
      resolved.push({ kind: 'path', path })
      continue
    }

    if (typeof entry.base64 === 'string' && entry.base64.trim()) {
      const bytes = Buffer.from(entry.base64, 'base64')
      if (bytes.length === 0) return { error: `[Error] ${at}.base64 did not decode to any bytes.` }
      resolved.push({
        kind: 'bytes',
        file: {
          uint8Array: new Uint8Array(bytes),
          ...(typeof entry.mediaType === 'string' && entry.mediaType ? { mediaType: entry.mediaType } : {}),
        },
      })
      continue
    }

    return { error: `[Error] ${at} needs either \`path\` (a file on disk) or \`base64\` (raw bytes); neither was set.` }
  }
  return { resolved }
}

/**
 * Write the byte entries in one batch and splice them back into their original positions, so the
 * gallery order matches the order the agent asked for.
 */
function materialize(
  resolved: ResolvedEntry[],
  persist: (files: PersistableFile[], outputDir: string, generationId: string) => SavedImage[],
  deps: NativeWidgetBuildDeps,
): string[] {
  const byteFiles = resolved.flatMap((entry) => entry.kind === 'bytes' ? [entry.file] : [])
  const written = byteFiles.length > 0 ? persist(byteFiles, deps.outputDir, deps.generationId) : []
  let cursor = 0
  return resolved.map((entry) => entry.kind === 'path' ? entry.path : written[cursor++].path)
}

export function buildNativeWidgetPayload(
  nativeType: NativeWidgetType,
  title: string,
  data: Record<string, unknown> | undefined,
  deps: NativeWidgetBuildDeps,
): BuiltNativeWidgetPayload {
  const fileExists = deps.fileExists ?? existsSync
  const field = nativeType === 'image-gallery' ? 'images' : 'videos'
  const { resolved, error } = resolveEntries(data?.[field], field, fileExists)
  if (!resolved) return { error }

  const prompt = typeof data?.prompt === 'string' && data.prompt.trim() ? data.prompt.trim() : undefined
  const params = toParams(data?.params)
  const warnings = toWarnings(data?.warnings)
  const shared = {
    status: 'completed' as const,
    ...(params.length > 0 ? { params } : {}),
    ...(warnings ? { warnings } : {}),
  }

  if (nativeType === 'image-gallery') {
    const paths = materialize(resolved, persistImages, deps)
    // Previews keep a large original out of the gallery thumb and out of the agent's Read path;
    // `attachImagePreviews` reuses the original when it is already small enough. Unlike SDK output,
    // these bytes came from arbitrary agent code, so a decoder that cannot read them must cost the
    // thumbnail and nothing more — the full-size image still renders from `savedPath`.
    let previews: SavedImage[] = []
    try {
      previews = attachImagePreviews(paths.map((path) => ({ path, mediaType: 'image/png' })), deps.previewDeps)
    } catch { /* fall back to the originals */ }
    const images: ImageGenerationItem[] = paths.map((savedPath, index) => {
      const previewPath = previews[index]?.previewPath
      return {
        id: `${deps.generationId}-${index}`,
        type: 'image_generation',
        ...shared,
        savedPath,
        ...(previewPath && previewPath !== savedPath ? { previewPath } : {}),
        ...(prompt ? { revisedPrompt: prompt } : {}),
      }
    })
    return { payload: { kind: 'native', nativeType, title, images } }
  }

  // Videos deliberately skip previews: the renderer plays the file from disk and a second copy of a
  // multi-megabyte clip buys nothing.
  const videos: VideoGenerationItem[] = materialize(resolved, persistVideos, deps).map((savedPath, index) => ({
    id: `${deps.generationId}-${index}`,
    type: 'video_generation',
    ...shared,
    savedPath,
    ...(prompt ? { prompt } : {}),
  }))
  return { payload: { kind: 'native', nativeType, title, videos } }
}
