import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, unlinkSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessCatalogReader, ExternalLaunchConfig } from './types'
import { resolveGrokRuntime } from './grok-runtime'
import { enableAcpGrok } from './enable'
import type { HarnessManager } from './manager'

const local = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: () => local.home }))
let root: string
let config: ExternalLaunchConfig
let command: string | undefined
let enabled: boolean
const catalog: HarnessCatalogReader = {
  get: () => ({ id: 'acp-grok', enabled, state: 'ready', runtimeSource: 'external', requiresAuth: false, command }),
  getExternalLaunchConfig: () => config,
}
function executable(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '#!/bin/sh\nexit 0\n'); chmodSync(path, 0o755)
  return path
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'grok-resolution-')); local.home = join(root, 'home')
  vi.stubEnv('PATH', join(root, 'bin')); vi.stubEnv('SUPERONE_ACP_BINARY', '')
  config = { commandSource: 'path' }; command = undefined; enabled = true
})
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }) })

describe('Grok command resolution', () => {
  it('keeps the PATH symlink so upgrades follow its new target', () => {
    const old = executable(join(root, 'grok-1.0.13'))
    const latest = executable(join(root, 'grok-1.0.30'))
    const link = join(root, 'bin', 'grok'); mkdirSync(dirname(link)); symlinkSync(old, link)
    expect(resolveGrokRuntime(catalog)?.command).toBe(link)
    unlinkSync(link); symlinkSync(latest, link)
    expect(realpathSync(resolveGrokRuntime(catalog)!.command)).toBe(realpathSync(latest))
  })
  it('re-resolves PATH instead of reusing the saved automatic command', () => {
    command = executable(join(root, 'old', 'grok'))
    const latest = executable(join(root, 'bin', 'grok'))
    expect(resolveGrokRuntime(catalog)?.command).toBe(latest)
  })
  it('repairs missing legacy version paths only in the Grok install directory', () => {
    config = {}; command = join(local.home, '.grok', 'bin', 'grok-1.0.13')
    const latest = executable(join(root, 'bin', 'grok'))
    expect(resolveGrokRuntime(catalog)?.command).toBe(latest)
    command = join(root, 'custom-missing')
    expect(resolveGrokRuntime(catalog)).toBeNull()
  })
  it('keeps existing legacy pins when provenance is unknown', () => {
    config = {}; command = executable(join(local.home, '.grok', 'bin', 'grok-1.0.13'))
    executable(join(root, 'bin', 'grok'))
    expect(resolveGrokRuntime(catalog)?.command).toBe(command)
  })
  it('does not replace a missing explicit version pin', () => {
    config = { commandSource: 'explicit', command: join(local.home, '.grok', 'bin', 'grok-1.0.13') }
    executable(join(root, 'bin', 'grok'))
    expect(resolveGrokRuntime(catalog)).toBeNull()
  })
  it('uses an environment override and fails closed if it is invalid', () => {
    const override = executable(join(root, 'custom')); vi.stubEnv('SUPERONE_ACP_BINARY', override)
    expect(resolveGrokRuntime(catalog)?.command).toBe(override)
    vi.stubEnv('SUPERONE_ACP_BINARY', join(root, 'missing')); executable(join(root, 'bin', 'grok'))
    expect(resolveGrokRuntime(catalog)).toBeNull()
  })
  it('honors provider command, PATH and argv overrides', () => {
    const bin = executable(join(root, 'provider', 'custom-grok')); config.args = ['agent', 'stdio', '--custom']
    expect(resolveGrokRuntime(catalog, { command: 'custom-grok', env: { PATH: dirname(bin) } }))
      .toMatchObject({ command: bin, args: config.args })
    expect(resolveGrokRuntime(catalog, { command: bin, args: [] })?.args).toEqual([])
  })
  it('uses the stable Grok entry when PATH is minimal', () => {
    const binary = executable(join(local.home, '.grok', 'bin', 'grok'))
    expect(resolveGrokRuntime(catalog)?.command).toBe(binary)
  })
  it('does not launch disabled or missing installations', () => {
    expect(resolveGrokRuntime(catalog)).toBeNull()
    executable(join(root, 'bin', 'grok')); enabled = false
    expect(resolveGrokRuntime(catalog)).toBeNull()
  })
  it('records provenance and preserves symlinks at enable time', () => {
    const bin = executable(join(root, 'grok-1.0.30'))
    const link = join(root, 'bin', 'grok'); mkdirSync(dirname(link)); symlinkSync(bin, link)
    const update = vi.fn((_id, patch) => patch)
    enableAcpGrok({ update } as unknown as HarnessManager, { args: [] })
    const patch = update.mock.calls[0]![1]
    expect(patch.command).toBe(link)
    expect(JSON.parse(patch.configJson)).toMatchObject({ commandSource: 'path', args: ['agent', 'stdio'] })
    enableAcpGrok({ update } as unknown as HarnessManager, { command: bin, args: ['custom'] })
    expect(JSON.parse(update.mock.calls[1]![1].configJson)).toMatchObject({ commandSource: 'explicit', command: bin, args: ['custom'] })
  })
})
