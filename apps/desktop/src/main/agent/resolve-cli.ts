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

// Packaged sidecars use dedicated Helper.app clones for semantic Activity
// Monitor names. Their executable basenames must end in " Helper" so Electron
// resolves MainApplicationBundlePath and ICU as a helper under RUN_AS_NODE.
// Fall back to the stock Helper (then main) when a named clone is unavailable.
// Dev mode falls back to the caller's default runtime (see is.dev below).
export type NodeRuntimeVariant = 'default' | 'mcp-bridge' | 'llm-proxy'

type NamedRuntimeVariant = Exclude<NodeRuntimeVariant, 'default'>

/** Keep in sync with afterPack.cjs HELPER_VARIANTS nameSuffix values. */
const VARIANT_HELPER_SUFFIX: Record<NamedRuntimeVariant, string> = {
  'mcp-bridge': 'MCP Helper',
  'llm-proxy': 'LLM Proxy Helper',
}

const cachedRuntimeByVariant = new Map<NodeRuntimeVariant, NodeRuntime>()

function findHelper(variant: NodeRuntimeVariant): string | undefined {
  if (process.platform !== 'darwin') return undefined
  const appName = basename(process.execPath)
  const helperName = variant === 'default'
    ? `${appName} Helper`
    : `${appName} ${VARIANT_HELPER_SUFFIX[variant]}`
  const contentsDir = dirname(dirname(process.execPath))
  const helperPath = join(contentsDir, 'Frameworks', `${helperName}.app`, 'Contents', 'MacOS', helperName)
  if (existsSync(helperPath)) return helperPath
  return undefined
}

function packagedNodeRuntime(variant: NodeRuntimeVariant): NodeRuntime {
  const namedHelper = variant === 'default' ? undefined : findHelper(variant)
  const helper = namedHelper ?? findHelper('default')
  const executable = helper ?? process.execPath
  if (namedHelper) {
    log.info('[resolve-cli] packaged mode: using named Electron Helper variant=%s executable=%s', variant, namedHelper)
  } else if (helper) {
    log.info('[resolve-cli] packaged mode: using Electron Helper variant=%s executable=%s', variant, helper)
  } else {
    log.info('[resolve-cli] packaged mode: using Electron as Node runtime variant=%s executable=%s', variant, process.execPath)
  }
  return { executable, env: { ELECTRON_RUN_AS_NODE: '1' } }
}

export function getNodeRuntime(variant: NodeRuntimeVariant = 'default'): NodeRuntime {
  const cached = cachedRuntimeByVariant.get(variant)
  if (cached) return cached
  if (is.dev) {
    cachedRuntimeByVariant.set(variant, {})
    return {}
  }

  const runtime = packagedNodeRuntime(variant)
  cachedRuntimeByVariant.set(variant, runtime)
  return runtime
}
