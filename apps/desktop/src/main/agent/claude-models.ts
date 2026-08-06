import { query } from '@anthropic-ai/claude-agent-sdk'
import { mapClaudeModelInfo } from '@superone/claude'
import type { ModelOption } from '@superone/shared/agent-types'
import log from '../logger'
import { resolveSdkClaudeBinary } from './claude-binary'
import { makeClaudeSpawn } from './claude-spawn'

export async function fetchModels(cwd: string, env?: Record<string, string | undefined>): Promise<ModelOption[]> {
  try {
    log.info('[claude] fetchModels start cwd=%s platform=%s arch=%s', cwd, process.platform, process.arch)
    const q = query({
      prompt: 'hi',
      options: {
        cwd,
        pathToClaudeCodeExecutable: resolveSdkClaudeBinary(),
        spawnClaudeCodeProcess: makeClaudeSpawn(),
        maxTurns: 0,
        permissionMode: 'bypassPermissions',
        persistSession: false,
        env,
      },
    })
    await q.initializationResult()
    const models = await q.supportedModels()
    q.close()
    log.info('[claude] fetchModels success count=%d', models.length)
    return models.map(mapClaudeModelInfo)
  } catch (error) {
    log.warn('[claude] fetchModels failed: %s', error instanceof Error ? error.message : String(error))
    return []
  }
}

/**
 * Kept as a named export here for main-process call sites; the mapping itself
 * lives in @superone/claude so desktop and remote nodes read the catalog the
 * same way.
 */
export { mapClaudeModelInfo as mapModelInfo }
