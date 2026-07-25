import { persistTextArtifact } from '../agent/browser-artifact-store'

export const INLINE_ARTIFACT_LIMIT = 32_000
export const ARTIFACT_PREVIEW_CHARS = 600

// Spill a large one-shot result instead of flooding the model context. Live DOM
// data stays at the source because it is cheaper to query again than persist.
export function spillLargeBrowserField(
  payload: Record<string, unknown>,
  field: string,
  ext: string,
): Record<string, unknown> {
  const content = String(payload[field] ?? '')
  if (content.length <= INLINE_ARTIFACT_LIMIT) return payload
  const path = persistTextArtifact(content, ext)
  const { [field]: _omitted, ...rest } = payload
  if (!path) return { ...rest, [field]: content.slice(0, INLINE_ARTIFACT_LIMIT), bytes: content.length, spilled: false }
  return { ...rest, spilled: true, path, bytes: content.length, preview: content.slice(0, ARTIFACT_PREVIEW_CHARS) }
}
