import { Agent, Cursor, type ModelListItem, type SDKModel } from '@cursor/sdk'
import type { CursorResources } from '@superone/shared/agent-types'
import { resolveCursorApiKeyPlain } from './cursor-config'
import { mapCursorModel } from './cursor-model-selection'

/**
 * Probe Cursor account resources (models, user, repositories) via User API Key.
 */
export async function probeCursorResources(options: {
  apiKey?: string
  config?: unknown
  resolveApiKey?: (config: unknown) => string | undefined
}): Promise<CursorResources> {
  const resolve = options.resolveApiKey ?? resolveCursorApiKeyPlain
  const apiKey = options.apiKey ?? resolve(options.config)
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
    models: models.map((item: ModelListItem | SDKModel) => mapCursorModel(item)),
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

/** Validate a Cursor User API Key by calling `Cursor.me`. */
export async function validateCursorApiKey(apiKey: string): Promise<void> {
  await Cursor.me({ apiKey })
}

/** Re-export for tests / backend. */
export { Agent, Cursor }
