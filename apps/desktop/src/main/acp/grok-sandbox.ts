import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { parse as parseToml } from 'smol-toml'
import type { SandboxInfo } from '@superone/shared/agent-types'
import log from '../logger'

/**
 * Read the sandbox Grok will actually apply — SuperOne does not set it, so this is
 * observation, not configuration.
 *
 * Grok has a real OS-level sandbox (Landlock on Linux, Seatbelt on macOS) with
 * built-in profiles `off` (default) / `workspace` / `read-only` / `strict`, plus
 * custom profiles from `sandbox.toml`. It is applied to the whole process at
 * startup and is **irreversible**, which is why there is no toggle for it and why
 * reading it once is enough.
 *
 * Precedence below is measured against grok 1.0.5, not assumed:
 * - `--sandbox` is unavailable in ACP mode (`grok agent stdio` accepts only
 *   `--debug` / `--debug-file` / `--leader-socket`), so the flag is not a source.
 * - `GROK_SANDBOX` wins over the config file (verified: env `workspace` beat
 *   config `read-only`).
 * - Global `<GROK_HOME|~/.grok>/config.toml` `[sandbox] profile` is honored even
 *   though it is undocumented.
 * - A project's `.grok/config.toml` is **ignored** by grok — deliberately, since a
 *   repo that could weaken the sandbox would be an attack vector. Do not "fix"
 *   this by reading it.
 */
const TRUTHY = new Set(['1', 'true', 'yes'])

function envFlag(value: string | undefined): boolean | null {
  if (value === undefined) return null
  return TRUTHY.has(value.trim().toLowerCase())
}

function grokHome(env: NodeJS.ProcessEnv): string {
  const home = env.GROK_HOME?.trim()
  return home && home.length > 0 ? home : join(homedir(), '.grok')
}

interface SandboxSection {
  profile?: string
  autoAllowBash?: boolean
}

function readSandboxSection(text: string): SandboxSection {
  const table = parseToml(text) as Record<string, unknown>
  const section = table.sandbox
  if (!section || typeof section !== 'object') return {}
  const { profile, auto_allow_bash: autoAllowBash } = section as Record<string, unknown>
  return {
    profile: typeof profile === 'string' ? profile.trim() : undefined,
    autoAllowBash: typeof autoAllowBash === 'boolean' ? autoAllowBash : undefined,
  }
}

/**
 * Resolve Grok's effective sandbox. `readConfig` is injected so the precedence
 * rules can be tested without touching the real `~/.grok`; it returns null when
 * the file is absent or unreadable.
 */
export function resolveGrokSandbox(
  env: NodeJS.ProcessEnv,
  readConfig: (path: string) => string | null,
): SandboxInfo {
  let config: SandboxSection = {}
  const configPath = join(grokHome(env), 'config.toml')
  const text = readConfig(configPath)
  if (text !== null) {
    try {
      config = readSandboxSection(text)
    } catch (error) {
      // A config grok itself may reject — report off rather than guessing a profile.
      log.warn(`[grok-sandbox] could not parse ${configPath}:`, error)
    }
  }

  const envProfile = env.GROK_SANDBOX?.trim() || env.GROK_SANDBOX_PROFILE?.trim()
  const profile = envProfile || config.profile || 'off'
  const enabled = profile.length > 0 && profile !== 'off'

  return {
    enabled,
    // Only meaningful inside a sandbox: it relaxes bash prompting, it does not
    // create confinement.
    autoAllowBash: enabled
      && (envFlag(env.GROK_SANDBOX_AUTO_ALLOW_BASH) ?? config.autoAllowBash ?? false),
  }
}

/** Production reader — missing or unreadable config means "no config". */
export function readGrokConfig(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export function currentGrokSandbox(): SandboxInfo {
  return resolveGrokSandbox(process.env, readGrokConfig)
}
