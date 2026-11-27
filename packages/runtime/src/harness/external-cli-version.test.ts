import { chmodSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildHarnessDiagnostic,
  type HarnessDiagnosticFields,
  type HarnessInstallationStatus,
  type NodeHarnessId,
} from '@superone/shared/environment'
import {
  assertSessionHarnessRuntimeReady,
  clearExternalCliVersionCache,
  enableAcpAntigravity,
  enableAcpGrok,
  enableOpencode,
  evaluateExternalCliCompatibility,
  probeExternalCliVersion,
  probeHarnessReadiness,
  type HarnessManager,
  type HarnessRuntimeResolver,
} from './index'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function writeFakeCli(dir: string, name: string, versionOutput: string): string {
  const binPath = join(dir, name)
  writeFileSync(binPath, `#!/bin/sh\necho "${versionOutput}"\n`, 'utf8')
  chmodSync(binPath, 0o755)
  return binPath
}

function createFakeHarnessManager(): HarnessManager {
  const statuses = new Map<NodeHarnessId, HarnessInstallationStatus>()
  const configs = new Map<NodeHarnessId, Record<string, unknown>>()

  const getStatus = (id: NodeHarnessId): HarnessInstallationStatus => {
    const existing = statuses.get(id)
    if (existing) return existing
    const init: HarnessInstallationStatus = {
      id,
      enabled: false,
      state: 'disabled',
      runtimeSource: 'external',
      requiresAuth: false,
    }
    statuses.set(id, init)
    return init
  }

  return {
    get: getStatus,
    update: (id: NodeHarnessId, patch: Record<string, unknown>) => {
      const current = { ...getStatus(id) }
      if (typeof patch.enabled === 'boolean') current.enabled = patch.enabled
      if (typeof patch.state === 'string') current.state = patch.state as HarnessInstallationStatus['state']
      if ('command' in patch) current.command = (patch.command as string | null) ?? undefined
      if ('runtimeVersion' in patch) current.runtimeVersion = (patch.runtimeVersion as string | null) ?? undefined
      if ('diagnosticCode' in patch) {
        current.diagnostic = patch.diagnosticCode
          ? buildHarnessDiagnostic(
              patch.diagnosticCode as Parameters<typeof buildHarnessDiagnostic>[0],
              (patch.diagnosticFields as HarnessDiagnosticFields | null) ?? undefined,
            )
          : undefined
      }
      if (typeof patch.configJson === 'string') {
        try {
          configs.set(id, JSON.parse(patch.configJson) as Record<string, unknown>)
        } catch {
          configs.set(id, {})
        }
      }
      statuses.set(id, current)
      return current
    },
    getExternalLaunchConfig: (id: NodeHarnessId) => configs.get(id) ?? {},
  } as unknown as HarnessManager
}

afterEach(() => {
  clearExternalCliVersionCache()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('external CLI version probe and compatibility gating', () => {
  it('probes CLI version, caches by stat, and refreshes when binary is upgraded on disk', () => {
    const dir = makeTempDir('superone-ext-cli-ver-')
    const bin = writeFakeCli(dir, 'agy', 'agy 1.5.10')

    expect(probeExternalCliVersion(bin)).toBe('1.5.10')
    expect(evaluateExternalCliCompatibility('acp-antigravity', bin)).toMatchObject({
      compatible: false,
      version: '1.5.10',
      minVersion: '1.5.16',
    })

    writeFakeCli(dir, 'agy', 'agy 1.5.18')
    const future = new Date(Date.now() + 5_000)
    utimesSync(bin, future, future)

    expect(probeExternalCliVersion(bin)).toBe('1.5.18')
    expect(evaluateExternalCliCompatibility('acp-antigravity', bin)).toEqual({
      compatible: true,
      version: '1.5.18',
      minVersion: '1.5.16',
    })
  })

  it('marks outdated external CLIs incompatible on enable and promotes to ready after upgrade', () => {
    const agyDir = makeTempDir('superone-ext-cli-agy-')
    const grokDir = makeTempDir('superone-ext-cli-grok-')
    const ocDir = makeTempDir('superone-ext-cli-oc-')
    const agyBin = writeFakeCli(agyDir, 'agy', 'agy 1.5.3')
    const grokBin = writeFakeCli(grokDir, 'grok', 'grok 1.0.80')
    const ocBin = writeFakeCli(ocDir, 'opencode', 'opencode 1.9.0')

    const manager = createFakeHarnessManager()
    const agyStatus = enableAcpAntigravity(manager, { command: agyBin, args: [] })
    expect(agyStatus.state).toBe('incompatible')
    expect(agyStatus.runtimeVersion).toBe('1.5.3')
    expect(agyStatus.diagnostic?.code).toBe('incompatible')
    expect(agyStatus.diagnostic?.message).toContain('1.5.16')
    expect(agyStatus.diagnostic?.message).toContain('1.5.3')

    const grokStatus = enableAcpGrok(manager, { command: grokBin, args: [] })
    expect(grokStatus.state).toBe('incompatible')
    expect(grokStatus.runtimeVersion).toBe('1.0.80')
    expect(grokStatus.diagnostic?.code).toBe('incompatible')

    const ocStatus = enableOpencode(manager, { command: ocBin })
    expect(ocStatus.state).toBe('incompatible')
    expect(ocStatus.runtimeVersion).toBe('1.9.0')
    expect(ocStatus.diagnostic?.code).toBe('incompatible')

    const resolver: HarnessRuntimeResolver = {
      resolveBinary: (id) => {
        if (id === 'acp-antigravity') return agyBin
        if (id === 'acp-grok') return grokBin
        if (id === 'opencode') return ocBin
        return null
      },
      isRunnableWithoutCatalog: () => false,
      autoRuntime: () => null,
    }

    expect(assertSessionHarnessRuntimeReady('acp-antigravity', manager, resolver)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('1.5.16'),
    })
    expect(assertSessionHarnessRuntimeReady('acp-grok', manager, resolver)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('1.0.92'),
    })
    expect(assertSessionHarnessRuntimeReady('opencode', manager, resolver)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('2.0.0'),
    })

    expect(probeHarnessReadiness(manager, 'acp-antigravity', { resolver })).toMatchObject({
      ok: false,
      state: 'incompatible',
    })
    expect(probeHarnessReadiness(manager, 'acp-grok', { resolver })).toMatchObject({
      ok: false,
      state: 'incompatible',
    })
    expect(probeHarnessReadiness(manager, 'opencode', { resolver })).toMatchObject({
      ok: false,
      state: 'incompatible',
    })

    writeFakeCli(agyDir, 'agy', 'agy 1.5.18')
    writeFakeCli(grokDir, 'grok', 'grok 1.0.92')
    writeFakeCli(ocDir, 'opencode', 'opencode 2.0.1')
    clearExternalCliVersionCache()

    expect(probeHarnessReadiness(manager, 'acp-antigravity', { resolver })).toMatchObject({
      ok: true,
      transitioned: true,
      state: 'ready',
    })
    expect(manager.get('acp-antigravity').runtimeVersion).toBe('1.5.18')

    expect(probeHarnessReadiness(manager, 'acp-grok', { resolver })).toMatchObject({
      ok: true,
      transitioned: true,
      state: 'ready',
    })
    expect(manager.get('acp-grok').runtimeVersion).toBe('1.0.92')

    expect(probeHarnessReadiness(manager, 'opencode', { resolver })).toMatchObject({
      ok: true,
      transitioned: true,
      state: 'ready',
    })
    expect(manager.get('opencode').runtimeVersion).toBe('2.0.1')

    expect(assertSessionHarnessRuntimeReady('acp-antigravity', manager, resolver).ok).toBe(true)
    expect(assertSessionHarnessRuntimeReady('acp-grok', manager, resolver).ok).toBe(true)
    expect(assertSessionHarnessRuntimeReady('opencode', manager, resolver).ok).toBe(true)
  })

  it('skips local OpenCode CLI version gating when a remote serverUrl is configured', () => {
    const ocBin = writeFakeCli(makeTempDir('superone-ext-cli-oc-old-'), 'opencode', 'opencode 1.2.0')
    const manager = createFakeHarnessManager()
    enableOpencode(manager, { serverUrl: 'http://127.0.0.1:4096' })

    const resolver: HarnessRuntimeResolver = {
      resolveBinary: (id) => (id === 'opencode' ? ocBin : null),
      isRunnableWithoutCatalog: () => false,
      autoRuntime: () => null,
    }
    expect(probeHarnessReadiness(manager, 'opencode', { resolver })).toMatchObject({
      ok: true,
      state: 'ready',
    })
    expect(assertSessionHarnessRuntimeReady('opencode', manager, resolver).ok).toBe(true)
  })
})
