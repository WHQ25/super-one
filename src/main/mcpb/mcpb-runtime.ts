import { sep } from 'path'
import { homedir } from 'os'
import { spawn } from 'child_process'
import type { McpbManifest, McpbMcpConfig, McpbServerType, McpbUserConfigValues, McpbRuntimeAvailability } from '../../shared/mcpb-types'

export type { McpbUserConfigValues } from '../../shared/mcpb-types'

export interface ResolvedMcpbServer {
  command: string
  args: string[]
  env: Record<string, string>
}

export type RuntimeAvailability = McpbRuntimeAvailability

interface PlatformVars {
  HOME: string
  DESKTOP: string
  DOCUMENTS: string
  DOWNLOADS: string
}

function platformVars(home: string = homedir()): PlatformVars {
  return {
    HOME: home,
    DESKTOP: `${home}${sep}Desktop`,
    DOCUMENTS: `${home}${sep}Documents`,
    DOWNLOADS: `${home}${sep}Downloads`,
  }
}

function mergePlatformOverride(cfg: McpbMcpConfig, platform: NodeJS.Platform): McpbMcpConfig {
  const override = cfg.platform_overrides?.[platform as 'darwin' | 'win32' | 'linux']
  if (!override) return cfg
  return {
    command: override.command ?? cfg.command,
    args: override.args ?? cfg.args,
    env: { ...cfg.env, ...(override.env ?? {}) },
    platform_overrides: cfg.platform_overrides,
  }
}

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_.]*)\}/g

function substituteScalar(
  input: string,
  installDir: string,
  userConfig: McpbUserConfigValues,
  vars: PlatformVars,
): string {
  return input.replace(VAR_RE, (match, key: string) => {
    if (key === '__dirname') return installDir
    if (key === 'pathSeparator') return sep
    if (key === 'HOME') return vars.HOME
    if (key === 'DESKTOP') return vars.DESKTOP
    if (key === 'DOCUMENTS') return vars.DOCUMENTS
    if (key === 'DOWNLOADS') return vars.DOWNLOADS
    if (key.startsWith('user_config.')) {
      const ucKey = key.slice('user_config.'.length)
      const value = userConfig[ucKey]
      if (value == null) return ''
      if (Array.isArray(value)) return value.join(',')
      return String(value)
    }
    return match
  })
}

function expandArg(
  arg: string,
  installDir: string,
  userConfig: McpbUserConfigValues,
  vars: PlatformVars,
): string[] {
  const exact = arg.match(/^\$\{user_config\.([A-Za-z_][A-Za-z0-9_]*)\}$/)
  if (exact) {
    const value = userConfig[exact[1]]
    if (Array.isArray(value)) return value.map((v) => String(v))
    if (value == null) return ['']
    return [String(value)]
  }
  return [substituteScalar(arg, installDir, userConfig, vars)]
}

export interface ResolveOptions {
  manifest: McpbManifest
  installDir: string
  userConfig: McpbUserConfigValues
  platform?: NodeJS.Platform
  electronExecPath?: string
  home?: string
}

export function resolveMcpbServer(options: ResolveOptions): ResolvedMcpbServer {
  const platform = options.platform ?? process.platform
  const electronExecPath = options.electronExecPath ?? process.execPath
  const vars = platformVars(options.home)
  const cfg = mergePlatformOverride(options.manifest.server.mcp_config, platform)

  const subst = (s: string): string => substituteScalar(s, options.installDir, options.userConfig, vars)

  const args: string[] = []
  for (const arg of cfg.args) {
    args.push(...expandArg(arg, options.installDir, options.userConfig, vars))
  }

  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(cfg.env)) {
    env[k] = subst(v)
  }

  let command = subst(cfg.command ?? '')

  if (options.manifest.server.type === 'node') {
    command = electronExecPath
    env.ELECTRON_RUN_AS_NODE = '1'
  }

  if (options.manifest.server.type === 'uv' && !args.includes('--directory')) {
    args.unshift('--directory', options.installDir)
  }

  return { command, args, env }
}

function whichSync(bin: string, platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  return new Promise((resolve) => {
    const probe = platform === 'win32' ? 'where' : 'which'
    const proc = spawn(probe, [bin], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    proc.stdout.on('data', (chunk) => { out += String(chunk) })
    proc.on('error', () => resolve(undefined))
    proc.on('close', (code) => {
      if (code !== 0) return resolve(undefined)
      const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
      resolve(first || undefined)
    })
  })
}

export async function checkRuntimeAvailable(
  type: McpbServerType,
  options: { electronExecPath?: string } = {},
): Promise<RuntimeAvailability> {
  if (type === 'node') {
    return { ok: true, type, detectedPath: options.electronExecPath ?? process.execPath }
  }
  if (type === 'python') {
    const path = (await whichSync('python3')) ?? (await whichSync('python'))
    if (path) return { ok: true, type, detectedPath: path }
    return {
      ok: false, type, missing: 'python',
      hint: 'Python 3 is required by this bundle. Install it from https://python.org or your package manager.',
    }
  }
  if (type === 'uv') {
    const path = (await whichSync('uvx')) ?? (await whichSync('uv'))
    if (path) return { ok: true, type, detectedPath: path }
    return {
      ok: false, type, missing: 'uv',
      hint: 'uv is required by this bundle. Install via `curl -LsSf https://astral.sh/uv/install.sh | sh` or see https://docs.astral.sh/uv/.',
    }
  }
  return { ok: true, type }
}
