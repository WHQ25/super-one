import { createRequire } from 'module'
import { spawn } from 'child_process'
import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk'

const require = createRequire(import.meta.url)

let cached: string | undefined

export function getClaudeCliPath(): string | undefined {
  if (cached !== undefined) return cached || undefined
  try {
    const resolved = require.resolve('@anthropic-ai/claude-agent-sdk/cli.js')
    cached = resolved.replace('/app.asar/', '/app.asar.unpacked/')
  } catch {
    cached = ''
  }
  return cached || undefined
}

export function spawnClaudeProcess(options: SpawnOptions): SpawnedProcess {
  const env = { ...options.env }
  let command = options.command
  let args = options.args

  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1'
    args = [command, ...args]
    command = process.execPath
  }

  return spawn(command, args, {
    cwd: options.cwd,
    env,
    signal: options.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}
