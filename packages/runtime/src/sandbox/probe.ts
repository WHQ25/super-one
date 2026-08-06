/**
 * Electron-free sandbox dependency probe (desktop sandbox-platform parity).
 *
 * Linux needs bubblewrap (bwrap) + socat; macOS always supported; Windows unsupported.
 */

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import type {
  SandboxCapability,
  SandboxMode,
  SandboxProbeResult,
  SandboxSupportLevel,
} from '@superone/shared/agent-types'
import type { SandboxProbeRpcResult } from '@superone/shared/environment'

function detectWslVersion(): string | undefined {
  if (process.platform !== 'linux') return undefined
  try {
    const procVersion = readFileSync('/proc/version', { encoding: 'utf8' })
    const explicit = procVersion.match(/WSL(\d+)/i)
    if (explicit?.[1]) return explicit[1]
    if (procVersion.toLowerCase().includes('microsoft')) return '1'
    return undefined
  } catch {
    return undefined
  }
}

function whichSync(bin: string): string | null {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(cmd, [bin], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 1000,
  })
  if (result.status === 0 && result.stdout) {
    const first = result.stdout.split(/\r?\n/).find((line) => line.trim().length > 0)
    return first ? first.trim() : null
  }
  return null
}

function classifyPlatform(): { supportLevel: SandboxSupportLevel; reason?: string } {
  if (process.platform === 'darwin') return { supportLevel: 'always' }
  if (process.platform === 'linux') {
    const wsl = detectWslVersion()
    if (wsl === '1') {
      return { supportLevel: 'unsupported', reason: 'WSL1 不支持沙盒，请升级到 WSL2' }
    }
    return { supportLevel: 'conditional' }
  }
  if (process.platform === 'win32') {
    return { supportLevel: 'unsupported', reason: 'Windows 暂不支持沙盒（官方计划中）' }
  }
  return { supportLevel: 'unsupported', reason: `平台 ${process.platform} 不支持沙盒` }
}

let cachedCapability: SandboxCapability | null = null

export function getSandboxCapability(): SandboxCapability {
  if (cachedCapability) return cachedCapability
  const { supportLevel, reason } = classifyPlatform()
  const defaultMode: SandboxMode = supportLevel === 'always' ? 'on' : 'off'
  cachedCapability = {
    supportLevel,
    platform: process.platform,
    defaultMode,
    ...(reason ? { unsupportedReason: reason } : {}),
  }
  return cachedCapability
}

/** Test hook: clear capability cache. */
export function resetSandboxCapabilityCacheForTests(): void {
  cachedCapability = null
  cachedProbe = null
  inflightProbe = null
}

let cachedProbe: SandboxProbeResult | null = null
let inflightProbe: Promise<SandboxProbeResult> | null = null

const LINUX_INSTALL_HINT =
  'Debian/Ubuntu: sudo apt install bubblewrap socat\nFedora: sudo dnf install bubblewrap socat\nArch: sudo pacman -S bubblewrap socat'

async function runProbe(): Promise<SandboxProbeResult> {
  const capability = getSandboxCapability()
  if (capability.supportLevel === 'always') return { ok: true }
  if (capability.supportLevel === 'unsupported') {
    return {
      ok: false,
      missing: [],
      installHint: capability.unsupportedReason ?? '当前平台不支持沙盒',
    }
  }
  const missing: string[] = []
  if (whichSync('bwrap') === null) missing.push('bubblewrap')
  if (whichSync('socat') === null) missing.push('socat')
  if (missing.length === 0) return { ok: true }
  return { ok: false, missing, installHint: LINUX_INSTALL_HINT }
}

export async function probeSandboxDependencies(): Promise<SandboxProbeResult> {
  if (cachedProbe) return cachedProbe
  if (inflightProbe) return inflightProbe
  inflightProbe = runProbe().then((result) => {
    cachedProbe = result
    inflightProbe = null
    return result
  })
  return inflightProbe
}

/**
 * Full RPC payload: capability booleans (bwrap/socat) + desktop-compatible probe.
 */
export async function probeSandboxRpc(): Promise<SandboxProbeRpcResult> {
  const capability = getSandboxCapability()
  const probe = await probeSandboxDependencies()
  const bwrap =
    capability.supportLevel === 'always'
      ? true
      : capability.supportLevel === 'unsupported'
        ? false
        : whichSync('bwrap') !== null
  const socat =
    capability.supportLevel === 'always'
      ? true
      : capability.supportLevel === 'unsupported'
        ? false
        : whichSync('socat') !== null
  return {
    ok: probe.ok,
    supportLevel: capability.supportLevel,
    platform: capability.platform,
    defaultMode: capability.defaultMode,
    bwrap,
    socat,
    missing: probe.ok ? [] : probe.missing,
    ...(probe.ok ? {} : { installHint: probe.installHint }),
    ...(capability.unsupportedReason
      ? { unsupportedReason: capability.unsupportedReason }
      : {}),
    probe,
    capability,
  }
}

export function isSandboxEnableAllowed(mode: SandboxMode): boolean {
  if (mode === 'off') return true
  return getSandboxCapability().supportLevel !== 'unsupported'
}

export function coerceSandboxModeForCapability(
  mode: SandboxMode | undefined,
): SandboxMode | undefined {
  if (mode === undefined) return undefined
  if (getSandboxCapability().supportLevel === 'unsupported' && mode !== 'off') return 'off'
  return mode
}

/** Map sandboxMode string → Claude Agent SDK sandbox option. */
export function sandboxModeToSdkSandbox(
  mode: string | null | undefined,
): { enabled: true; autoAllowBashIfSandboxed: boolean; failIfUnavailable: false } | undefined {
  if (!mode || !mode.trim()) return undefined
  const m = mode.trim() as SandboxMode
  if (m === 'off') return undefined
  if (getSandboxCapability().supportLevel === 'unsupported') return undefined
  if (m !== 'on' && m !== 'auto') return undefined
  return {
    enabled: true,
    autoAllowBashIfSandboxed: m === 'auto',
    failIfUnavailable: false,
  }
}
