import { Agent, Cursor, type ModelListItem, type SDKModel } from '@cursor/sdk'
import type { CursorResources, ModelOption } from '@superone/shared/agent-types'
import { resolveCursorApiKey } from './cursor-auth'

function mapModel(item: ModelListItem | SDKModel): ModelOption {
  const id = item.id
  const displayName = 'displayName' in item && item.displayName ? item.displayName : id
  const parameters = 'parameters' in item ? item.parameters : undefined
  const effortParam = parameters?.find((p) =>
    /effort|reasoning|thinking/i.test(p.id) || /effort|reasoning/i.test(p.displayName ?? ''),
  )
  const allowed = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
  const supportedEffortLevels = effortParam?.values
    ?.map((v) => v.value)
    .filter((v): v is NonNullable<ModelOption['supportedEffortLevels']>[number] => allowed.has(v))
  return {
    id,
    name: displayName,
    description: ('description' in item && item.description) ? item.description : '',
    supportedEffortLevels: supportedEffortLevels?.length ? supportedEffortLevels : undefined,
  }
}

export async function probeCursorResources(options: {
  apiKey?: string
  config?: unknown
}): Promise<CursorResources> {
  const apiKey = options.apiKey ?? resolveCursorApiKey(options.config)
  if (!apiKey) {
    throw new Error(
      'Cursor User API Key missing. Create one at https://cursor.com/dashboard/api and set it in SuperOne Settings, or export CURSOR_API_KEY.',
    )
  }

  const [user, models, repositories] = await Promise.all([
    Cursor.me({ apiKey }).catch(() => null),
    Cursor.models.list({ apiKey }),
    Cursor.repositories.list({ apiKey }).catch(() => []),
  ])

  return {
    models: models.map(mapModel),
    user: user
      ? {
          apiKeyName: user.apiKeyName,
          userEmail: user.userEmail ?? null,
          userId: user.userId ?? null,
        }
      : null,
    repositories: repositories.map((r) => ({ url: r.url })),
    probing: false,
  }
}

export async function validateCursorApiKey(apiKey: string): Promise<void> {
  await Cursor.me({ apiKey })
}

/** Re-export for tests / backend. */
export { Agent, Cursor }
