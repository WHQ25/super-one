import { query, type Query } from '@anthropic-ai/claude-agent-sdk'
import type { ModelOption } from '../../shared/agent-types'

/** Create a throwaway query to fetch the model list. */
export async function fetchModels(cwd: string): Promise<ModelOption[]> {
  try {
    const q = query({
      prompt: 'hi',
      options: {
        cwd,
        maxTurns: 0,
        permissionMode: 'bypassPermissions',
      },
    })
    const models = await q.supportedModels()
    q.close()
    return models.map(mapModelInfo)
  } catch {
    return []
  }
}

/** Refresh model list from an active query (non-blocking). */
export async function refreshModelsFromQuery(activeQuery: Query): Promise<ModelOption[]> {
  try {
    const models = await activeQuery.supportedModels()
    return models.map(mapModelInfo)
  } catch {
    return []
  }
}

/** Extract a clean model name from SDK ModelInfo.
 *  If description contains "·" (e.g. "Opus 4.6 · Most capable..."),
 *  use left side as name and right side as description.
 *  Otherwise fall back to displayName + full description. */
export function mapModelInfo(m: { value: string; displayName: string; description?: string }): ModelOption {
  const desc = m.description ?? ''
  const sepIdx = desc.indexOf('·')
  if (sepIdx !== -1) {
    return {
      id: m.value,
      name: desc.slice(0, sepIdx).trim(),
      description: desc.slice(sepIdx + 1).trim(),
    }
  }
  return { id: m.value, name: m.displayName, description: desc }
}
