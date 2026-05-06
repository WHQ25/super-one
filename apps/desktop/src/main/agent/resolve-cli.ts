import { execFileSync } from 'child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import log from '../logger'

export function dedupePath(path: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of path.split(':')) {
    if (!entry || seen.has(entry)) continue
    seen.add(entry)
    out.push(entry)
  }
  return out.join(':')
}

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
      const before = shellPath.length
      const deduped = dedupePath(shellPath)
      process.env.PATH = deduped
      log.info('[fixPath] PATH updated via %s bytes=%d (deduped from %d)', shell, deduped.length, before)
      if (deduped.length > 1024) {
        log.warn('[fixPath] PATH still %dB after dedup — may trigger spawn ENAMETOOLONG on macOS', deduped.length)
      }
    }
  } catch {
    log.warn('[fixPath] Failed to get PATH from login shell')
  }
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
