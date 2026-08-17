import type { ModelOption } from '@superone/shared/agent-types'

export function findCodexFastServiceTier(
  model?: Pick<ModelOption, 'serviceTiers'> | null,
): NonNullable<ModelOption['serviceTiers']>[number] | undefined {
  return model?.serviceTiers?.find((tier) =>
    tier.id === 'fast'
    || tier.id === 'priority'
    || tier.name.trim().toLowerCase() === 'fast')
}
