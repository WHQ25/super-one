import type { ModelOption } from './agent-types'

export function findCodexFastServiceTier(
  model?: Pick<ModelOption, 'serviceTiers'> | null,
): NonNullable<ModelOption['serviceTiers']>[number] | undefined {
  return model?.serviceTiers?.find((tier) =>
    tier.id === 'fast'
    || tier.id === 'priority'
    || tier.name.trim().toLowerCase() === 'fast')
}

export function resolveCodexFastServiceTier(
  model: Pick<ModelOption, 'serviceTiers'> | null | undefined,
  enabled: boolean,
): string | null {
  return enabled ? (findCodexFastServiceTier(model)?.id ?? null) : null
}
