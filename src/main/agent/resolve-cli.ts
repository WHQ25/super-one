import { execFileSync, spawnSync } from 'child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'module'
import { basename, dirname, join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import log from '../logger'

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
      log.info('[fixPath] PATH updated via %s', shell)
    }
  } catch {
    log.warn('[fixPath] Failed to get PATH from login shell')
  }
}

export function findSystemClaude(): string | undefined {
  const cmd = process.platform === 'win32' ? 'where' : '/usr/bin/which'
  try {
    log.info('[findSystemClaude] probing with %s on %s/%s', cmd, process.platform, process.arch)
    const result = execFileSync(cmd, ['claude'], { timeout: 3000, stdio: 'pipe' })
    const bins = result.toString().split(/\r?\n/).map((v) => v.trim()).filter(Boolean)
    log.info('[findSystemClaude] candidates=%d', bins.length)
    for (const bin of bins) {
      if (process.platform === 'win32') {
        const probe = spawnSync(bin, ['--version'], {
          timeout: 3000,
          stdio: 'pipe',
          shell: true,
          windowsHide: true,
        })
        const ok = !probe.error && probe.status === 0
        log.info('[findSystemClaude] candidate=%s ok=%s', bin, ok)
        if (ok) return bin
      } else {
        execFileSync(bin, ['--version'], { timeout: 3000, stdio: 'pipe' })
        log.info('[findSystemClaude] candidate=%s ok=true', bin)
        return bin
      }
    }
  } catch (err) {
    log.warn('[findSystemClaude] failed: %s', (err as Error).message)
  }
  return undefined
}

export function resolveSdkCli(): string | undefined {
  try {
    const sdkDir = require.resolve('@anthropic-ai/claude-agent-sdk').replace(/[/\\][^/\\]+$/, '')
    const sep = sdkDir.includes('\\') ? '\\' : '/'
    return `${sdkDir}${sep}cli.js`.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  } catch {
    return undefined
  }
}

export function clearCliCache(): void {
  cachedPath = undefined
}

export function getClaudeCliPath(): string | undefined {
  if (cachedPath !== undefined) return cachedPath || undefined
  cachedPath = findSystemClaude() ?? resolveSdkCli() ?? ''
  log.info('[resolve-cli] resolved=%s platform=%s arch=%s', cachedPath || 'none', process.platform, process.arch)
  return cachedPath || undefined
}

export interface NodeRuntime {
  executable?: string
  env?: Record<string, string>
}

let cachedRuntime: NodeRuntime | undefined

function findElectronHelper(): string | undefined {
  if (process.platform !== 'darwin') return undefined
  const appName = basename(process.execPath)
  const contentsDir = dirname(dirname(process.execPath))
  const helperPath = join(contentsDir, 'Frameworks', `${appName} Helper.app`, 'Contents', 'MacOS', `${appName} Helper`)
  if (existsSync(helperPath)) return helperPath
  return undefined
}

export function getNodeRuntime(): NodeRuntime {
  if (cachedRuntime) return cachedRuntime
  if (is.dev) {
    cachedRuntime = {}
    return cachedRuntime
  }
  const helper = findElectronHelper()
  if (helper) {
    cachedRuntime = { executable: helper, env: { ELECTRON_RUN_AS_NODE: '1' } }
    log.info('[resolve-cli] packaged mode: using Electron Helper (no dock icon) executable=%s', helper)
  } else {
    cachedRuntime = { executable: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }
    log.info('[resolve-cli] packaged mode: using Electron as Node runtime executable=%s', process.execPath)
  }
  return cachedRuntime
}
