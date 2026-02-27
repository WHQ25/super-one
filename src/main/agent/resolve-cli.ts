import { execFileSync } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

let cachedPath: string | undefined

export function fixPath(): void {
  if (process.platform === 'win32') return
  try {
    const shell = process.env.SHELL || '/bin/sh'
    const result = execFileSync(shell, ['-ilc', 'printf "%s" "$PATH"'], {
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const shellPath = result.toString().trim()
    if (shellPath) {
      process.env.PATH = shellPath
      console.log('[fixPath] PATH updated via', shell, '→', shellPath)
    }
  } catch {
    console.warn('[fixPath] Failed to get PATH from login shell')
  }
}

export function findSystemClaude(): string | undefined {
  const cmd = process.platform === 'win32' ? 'where' : '/usr/bin/which'
  try {
    const result = execFileSync(cmd, ['claude'], { timeout: 3000, stdio: 'pipe' })
    const bin = result.toString().trim().split(/\r?\n/)[0]
    if (bin) {
      execFileSync(bin, ['--version'], { timeout: 3000, stdio: 'pipe' })
      return bin
    }
  } catch (err) {
    console.warn('[findSystemClaude] failed:', (err as Error).message)
  }
  return undefined
}

function findSdkCli(): string | undefined {
  try {
    return require.resolve('@anthropic-ai/claude-agent-sdk/cli.js').replace('/app.asar/', '/app.asar.unpacked/')
  } catch {
    return undefined
  }
}

export function clearCliCache(): void {
  cachedPath = undefined
}

export function getClaudeCliPath(): string | undefined {
  if (cachedPath !== undefined) return cachedPath || undefined
  cachedPath = findSystemClaude() ?? findSdkCli() ?? ''
  console.log('[resolve-cli] resolved:', cachedPath || 'none')
  return cachedPath || undefined
}
