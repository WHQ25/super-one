import { query, type Query } from '@anthropic-ai/claude-agent-sdk'
import type { ModelOption } from '../../shared/agent-types'
import log from '../logger'

/** Create a throwaway query to fetch the model list. */
export async function fetchModels(cwd: string, env?: Record<string, string | undefined>): Promise<ModelOption[]> {
  try {
    log.info('[claude] fetchModels start cwd=%s platform=%s arch=%s', cwd, process.platform, process.arch)
    const q = query({
      prompt: 'hi',
      options: {
        cwd,
        maxTurns: 0,
        permissionMode: 'bypassPermissions',
        env,
      },
    })
    const models = await q.supportedModels()
    q.close()
    log.info('[claude] fetchModels success count=%d', models.length)
    return models.map(mapModelInfo)
  } catch (error) {
    log.warn('[claude] fetchModels failed: %s', error instanceof Error ? error.message : String(error))
    return []
  }
}

/** Refresh model list from an active query (non-blocking). */
export async function refreshModelsFromQuery(activeQuery: Query): Promise<ModelOption[]> {
  try {
    const models = await activeQuery.supportedModels()
    log.info('[claude] refreshModelsFromQuery success count=%d', models.length)
    return models.map(mapModelInfo)
  } catch (error) {
    log.warn('[claude] refreshModelsFromQuery failed: %s', error instanceof Error ? error.message : String(error))
    return []
  }
}

/** Extract a clean model name from SDK ModelInfo.
 *  If description contains "·" (e.g. "Opus 4.6 · Most capable..."),
 *  use left side as name and right side as description.
 *  Otherwise fall back to displayName + full description. */
export function mapModelInfo(m: { value: string; displayName: string; description?: string; supportsEffort?: boolean; supportedEffortLevels?: string[]; supportsAdaptiveThinking?: boolean }): ModelOption {
  const desc = m.description ?? ''
  const sepIdx = desc.indexOf('·')
  const base: ModelOption = sepIdx !== -1
    ? { id: m.value, name: desc.slice(0, sepIdx).trim(), description: desc.slice(sepIdx + 1).trim() }
    : { id: m.value, name: m.displayName, description: desc }
  if (m.supportsEffort) base.supportsEffort = true
  if (m.supportedEffortLevels?.length) base.supportedEffortLevels = m.supportedEffortLevels as ModelOption['supportedEffortLevels']
  if (m.supportsAdaptiveThinking) base.supportsAdaptiveThinking = true
  return base
}
