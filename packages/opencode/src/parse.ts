import type { EffortLevel, ModelOption, SlashCommandInfo } from '@superone/shared/agent-types'

const effortLevels = new Set<EffortLevel>(['low', 'medium', 'high', 'xhigh', 'max'])

export function parseOpenCodeModelSlug(
  model: string | null | undefined,
): { providerID: string; modelID: string } | null {
  const value = model?.trim()
  if (!value) return null
  const separator = value.indexOf('/')
  if (separator <= 0 || separator === value.length - 1) return null
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) }
}

/** Minimal shape of OpenCode provider.list() payload used by SuperOne. */
export interface OpenCodeProviderListPayload {
  connected: string[]
  default: Record<string, string>
  all: Array<{
    id: string
    name: string
    models: Record<
      string,
      {
        id: string
        name?: string
        limit: { context?: number }
        capabilities?: { reasoning?: boolean }
        variants?: Record<string, unknown>
      }
    >
  }>
}

export function parseModels(payload: OpenCodeProviderListPayload): ModelOption[] {
  const connected = new Set(payload.connected)
  return payload.all
    .filter((provider) => connected.has(provider.id))
    .flatMap((provider) =>
      Object.values(provider.models).map((model) => {
        const supportedEffortLevels = Object.keys(model.variants ?? {}).filter(
          (value): value is EffortLevel => effortLevels.has(value as EffortLevel),
        )
        return {
          id: `${provider.id}/${model.id}`,
          name: model.name || model.id,
          description: `${provider.name} ${model.capabilities?.reasoning ? 'reasoning' : 'chat'} model`,
          isDefault: payload.default[provider.id] === model.id,
          contextWindow: model.limit.context,
          supportsEffort: supportedEffortLevels.length > 0,
          supportedEffortLevels:
            supportedEffortLevels.length > 0 ? supportedEffortLevels : undefined,
        }
      }),
    )
}

export function parseOpenCodeCommands(
  commands: Array<{ name: string; description?: string; hints?: string[]; source?: string }>,
): SlashCommandInfo[] {
  return commands.map((command) => ({
    name: command.name.replace(/^\//, ''),
    description: command.description ?? '',
    argumentHint: (command.hints ?? []).join(' '),
    isSkill: command.source === 'skill',
  }))
}
