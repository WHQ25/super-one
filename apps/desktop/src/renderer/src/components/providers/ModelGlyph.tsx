import { ModelIcon, modelMappings } from '@lobehub/icons'
import { ProviderLabel } from '../ProviderLabel'

export function hasModelIcon(modelId: string): boolean {
  return modelMappings.some((entry) =>
    entry.keywords.some((keyword) => new RegExp(keyword, 'i').test(modelId)),
  )
}

export function ModelGlyph({
  modelId,
  providerBrand,
  size,
}: {
  modelId: string
  providerBrand?: string
  size: number
}) {
  return hasModelIcon(modelId)
    ? <ModelIcon model={modelId} type="color" size={size} />
    : <ProviderLabel brandKey={providerBrand} iconOnly size={size} />
}
