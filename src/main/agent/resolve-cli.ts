import { createRequire } from 'module'

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
