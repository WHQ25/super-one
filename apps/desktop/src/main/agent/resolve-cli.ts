import { execFileSync } from 'child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import log from '../logger'
import { sanitizePathEnv } from '../spawn-env'

const PATH_OUTPUT_START = '__SUPERONE_PATH_OUTPUT_START__'
const PATH_OUTPUT_END = '__SUPERONE_PATH_OUTPUT_END__'

function extractPath(output: string): string {
  const start = output.lastIndexOf(PATH_OUTPUT_START)
  if (start < 0) throw new Error('PATH start marker missing')
  const valueStart = start + PATH_OUTPUT_START.length
  const end = output.indexOf(PATH_OUTPUT_END, valueStart)
  if (end < 0) throw new Error('PATH end marker missing')
  return output.slice(valueStart, end)
}

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
    const result = execFileSync(shell, ['-ilc', `printf '${PATH_OUTPUT_START}%s${PATH_OUTPUT_END}' "$PATH"`], {
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const shellPath = extractPath(result.toString())
    if (shellPath) {
      const { value: cleanPath, dropped, deduped } = sanitizePathEnv(shellPath)
      process.env.PATH = cleanPath
      log.info('[fixPath] PATH updated via %s bytes=%d (deduped %d, dropped %d over-long)', shell, cleanPath.length, deduped, dropped)
      if (cleanPath.length > 32768) {
        log.warn('[fixPath] PATH still %dB after sanitize — very long, command resolution may be slow', cleanPath.length)
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

// 'mcp-bridge' and 'llm-proxy' each resolve to a dedicated Helper.app clone (built
// by build/afterPack.cjs — keep the suffix strings in sync with HELPER_VARIANTS
// there) so the process shows a real name in Activity Monitor instead of the
// generic "SuperOne Helper" shared by GPU/network/renderer subprocesses. Only
// exists in packaged mode; dev falls back to 'default' behavior (see is.dev below).
export type NodeRuntimeVariant = 'default' | 'mcp-bridge' | 'llm-proxy'

const VARIANT_HELPER_SUFFIX: Record<Exclude<NodeRuntimeVariant, 'default'>, string> = {
  'mcp-bridge': 'MCP Bridge',
  'llm-proxy': 'LLM Proxy',
}

const cachedRuntimeByVariant = new Map<NodeRuntimeVariant, NodeRuntime>()

function findElectronHelper(variant: NodeRuntimeVariant): string | undefined {
  if (process.platform !== 'darwin') return undefined
  const appName = basename(process.execPath)
  const helperName = variant === 'default' ? `${appName} Helper` : `${appName} ${VARIANT_HELPER_SUFFIX[variant]}`
  const contentsDir = dirname(dirname(process.execPath))
  const helperPath = join(contentsDir, 'Frameworks', `${helperName}.app`, 'Contents', 'MacOS', helperName)
  if (existsSync(helperPath)) return helperPath
  return undefined
}

export function getNodeRuntime(variant: NodeRuntimeVariant = 'default'): NodeRuntime {
  const cached = cachedRuntimeByVariant.get(variant)
  if (cached) return cached
  if (is.dev) {
    cachedRuntimeByVariant.set(variant, {})
    return {}
  }
  // Fall back to the plain Helper (still Dock-safe, just unnamed) if the named
  // variant's bundle wasn't found — e.g. afterPack didn't run for this build.
  const helper = findElectronHelper(variant) ?? findElectronHelper('default')
  const runtime: NodeRuntime = helper
    ? { executable: helper, env: { ELECTRON_RUN_AS_NODE: '1' } }
    : { executable: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }
  if (helper) {
    log.info('[resolve-cli] packaged mode: using Electron Helper variant=%s executable=%s', variant, helper)
  } else {
    log.info('[resolve-cli] packaged mode: using Electron as Node runtime executable=%s', process.execPath)
  }
  cachedRuntimeByVariant.set(variant, runtime)
  return runtime
}
