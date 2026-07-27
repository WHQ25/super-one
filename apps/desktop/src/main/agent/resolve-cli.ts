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

// Named sidecars (mcp-bridge, llm-proxy) resolve to a MacOS sibling of the main
// Electron executable, cloned by build/afterPack.cjs — keep VARIANT_MAIN_SUFFIX
// in sync with NODE_RUNTIME_VARIANTS there. That gives a distinct Activity
// Monitor name without using Helper.app clones, which Electron rejects under
// ELECTRON_RUN_AS_NODE when the basename is not a known helper suffix.
// Dev mode falls back to the caller's default runtime (see is.dev below).
export type NodeRuntimeVariant = 'default' | 'mcp-bridge' | 'llm-proxy'

type NamedRuntimeVariant = Exclude<NodeRuntimeVariant, 'default'>

/** Keep in sync with afterPack.cjs NODE_RUNTIME_VARIANTS suffixes. */
const VARIANT_MAIN_SUFFIX: Record<NamedRuntimeVariant, string> = {
  'mcp-bridge': 'MCP Bridge',
  'llm-proxy': 'LLM Proxy',
}

const cachedRuntimeByVariant = new Map<NodeRuntimeVariant, NodeRuntime>()

function findPlainHelper(): string | undefined {
  if (process.platform !== 'darwin') return undefined
  const appName = basename(process.execPath)
  const helperName = `${appName} Helper`
  const contentsDir = dirname(dirname(process.execPath))
  const helperPath = join(contentsDir, 'Frameworks', `${helperName}.app`, 'Contents', 'MacOS', helperName)
  if (existsSync(helperPath)) return helperPath
  return undefined
}

/** Main-stub sibling written by afterPack, e.g. `.../MacOS/SuperOne MCP Bridge`. */
function findNamedMainStub(variant: NamedRuntimeVariant): string | undefined {
  if (process.platform !== 'darwin') return undefined
  const appName = basename(process.execPath)
  const named = join(dirname(process.execPath), `${appName} ${VARIANT_MAIN_SUFFIX[variant]}`)
  if (existsSync(named)) return named
  return undefined
}

export function getNodeRuntime(variant: NodeRuntimeVariant = 'default'): NodeRuntime {
  const cached = cachedRuntimeByVariant.get(variant)
  if (cached) return cached
  if (is.dev) {
    cachedRuntimeByVariant.set(variant, {})
    return {}
  }

  if (variant !== 'default') {
    const named = findNamedMainStub(variant)
    const executable = named ?? process.execPath
    const runtime = { executable, env: { ELECTRON_RUN_AS_NODE: '1' } }
    if (named) {
      log.info('[resolve-cli] packaged mode: using named node runtime variant=%s executable=%s', variant, named)
    } else {
      log.info(
        '[resolve-cli] packaged mode: named node runtime missing for variant=%s, falling back to Electron executable=%s',
        variant,
        process.execPath,
      )
    }
    cachedRuntimeByVariant.set(variant, runtime)
    return runtime
  }

  // Unnamed default: prefer plain Helper (Dock-safe process name "SuperOne Helper")
  // when available; otherwise the main executable.
  const helper = findPlainHelper()
  const runtime: NodeRuntime = helper
    ? { executable: helper, env: { ELECTRON_RUN_AS_NODE: '1' } }
    : { executable: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }
  if (helper) {
    log.info('[resolve-cli] packaged mode: using Electron Helper executable=%s', helper)
  } else {
    log.info('[resolve-cli] packaged mode: using Electron as Node runtime executable=%s', process.execPath)
  }
  cachedRuntimeByVariant.set(variant, runtime)
  return runtime
}
