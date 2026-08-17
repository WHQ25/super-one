import { ModelIcon, modelMappings } from '@lobehub/icons'
import { ProviderLabel } from '../ProviderLabel'

function mappingIndex(text: string): number {
  const model = text.toLowerCase()
  return modelMappings.findIndex((entry) =>
    entry.keywords.some((keyword) => new RegExp(keyword, 'i').test(model)),
  )
}

export function hasModelIcon(modelId: string): boolean {
  return mappingIndex(modelId) >= 0
}

function iconCandidates(modelId: string, aliases: Array<string | null | undefined>): string[] {
  const out: string[] = []
  const add = (raw?: string | null) => {
    const t = raw?.trim()
    if (!t) return
    for (const variant of [t, t.replace(/\s+/g, '-'), t.replace(/[\s-]+/g, '')]) {
      if (!out.includes(variant)) out.push(variant)
    }
  }
  add(modelId)
  for (const alias of aliases) add(alias)
  return out
}

/**
 * Pick the string that hits the most specific `@lobehub/icons` mapping.
 * Mappings are ordered specific → generic (`nano-banana` before `gemini`), so a
 * relay id like `gemini-3.1-flash-image` plus display name "Nano Banana 2"
 * should use the banana icon, not the generic Gemini mark.
 */
export function resolveModelIconKey(
  modelId: string,
  ...aliases: Array<string | null | undefined>
): string | null {
  let best: { key: string; index: number } | null = null
  for (const key of iconCandidates(modelId, aliases)) {
    const index = mappingIndex(key)
    if (index < 0) continue
    if (!best || index < best.index) best = { key, index }
  }
  return best?.key ?? null
}

export function ModelGlyph({
  modelId,
  modelName,
  providerBrand,
  size,
}: {
  modelId: string
  modelName?: string | null
  providerBrand?: string
  size: number
}) {
  const key = resolveModelIconKey(modelId, modelName)
  return key
    ? <ModelIcon model={key} type="color" size={size} />
    : <ProviderLabel brandKey={providerBrand} iconOnly size={size} />
}
