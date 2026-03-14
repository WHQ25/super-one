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

const MODEL_NAME_RE = /^(\w+ [\d.]+)(?:\s+with\s+(\w+)\s+context)?/

function extractModelName(descPrefix: string): string | null {
  const match = descPrefix.match(MODEL_NAME_RE)
  if (!match) return null
  return match[2] ? `${match[1]} ${match[2]}` : match[1]
}

export function mapModelInfo(m: { value: string; displayName: string; description?: string; supportsEffort?: boolean; supportedEffortLevels?: string[]; supportsAdaptiveThinking?: boolean; supportsFastMode?: boolean }): ModelOption {
  const raw = m.description ?? ''
  const sepIdx = raw.indexOf('·')
  const descPrefix = sepIdx !== -1 ? raw.slice(0, sepIdx).trim() : ''
  const name = extractModelName(descPrefix) ?? m.displayName
  const base: ModelOption = { id: m.value, name, description: raw }
  if (m.supportsEffort) base.supportsEffort = true
  if (m.supportedEffortLevels?.length) base.supportedEffortLevels = m.supportedEffortLevels as ModelOption['supportedEffortLevels']
  if (m.supportsAdaptiveThinking) base.supportsAdaptiveThinking = true
  if (m.supportsFastMode) base.supportsFastMode = true
  return base
}
