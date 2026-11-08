import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  enableAcpAntigravity,
  isLegacyAntigravityServerCommand,
  resolveAntigravityCommand,
  resolveAntigravityRuntime,
} from './antigravity-runtime'
import type { HarnessManager } from './manager'
import type { HarnessCatalogReader } from './types'

function createExecutable(filePath: string, content = '#!/bin/sh\necho agy 1.5.3\n'): void {
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
  chmodSync(filePath, 0o755)
}

describe('resolveAntigravityCommand and resolveAntigravityRuntime', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'so-agy-rt-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('recognizes legacy 1.4.5 agy_acp_server binary names', () => {
    expect(isLegacyAntigravityServerCommand('/opt/agy_acp_server.par')).toBe(true)
    expect(isLegacyAntigravityServerCommand('C:\\agy\\agy_acp_server.exe')).toBe(true)
    expect(isLegacyAntigravityServerCommand('agy_acp_server')).toBe(true)
    expect(isLegacyAntigravityServerCommand('/Users/me/.local/bin/agy')).toBe(false)
  })

  it('resolves agy from PATH and falls back to ~/.local/bin/agy', () => {
    const pathBinDir = join(root, 'path-bin')
    const pathAgy = join(pathBinDir, 'agy')
    createExecutable(pathAgy)

    expect(
      resolveAntigravityCommand(undefined, {
        pathEnv: pathBinDir,
        homeDir: root,
        platform: 'darwin',
      }),
    ).toBe(pathAgy)

    const fallbackAgy = join(root, '.local', 'bin', 'agy')
    createExecutable(fallbackAgy)

    expect(
      resolveAntigravityCommand(undefined, {
        pathEnv: join(root, 'empty-path'),
        homeDir: root,
        platform: 'darwin',
      }),
    ).toBe(fallbackAgy)
  })

  it('resolves external runtime with default args ["acp"] and migrates legacy agy_acp_server.par', () => {
    const localAgy = join(root, '.local', 'bin', 'agy')
    createExecutable(localAgy)

    const catalog: HarnessCatalogReader = {
      get: () => ({
        id: 'acp-antigravity',
        runtimeSource: 'external',
        enabled: true,
        state: 'ready',
        requiresAuth: false,
        command: '/old/.superone/harness/acp-antigravity/versions/1.4.5/agy_acp_server.par',
        runtimeVersion: '1.4.5',
      }),
      getExternalLaunchConfig: () => ({
        command: '/old/.superone/harness/acp-antigravity/versions/1.4.5/agy_acp_server.par',
        args: ['--uid='],
      }),
    }

    const resolved = resolveAntigravityRuntime(catalog, {
      homeDir: root,
      platform: 'darwin',
      override: {
        command: 'agy_acp_server.par',
        args: ['--uid='],
        env: { PATH: join(root, 'empty-path') },
      },
    })

    expect(resolved).toEqual({
      command: localAgy,
      executablePath: localAgy,
      args: ['acp'],
      source: 'path',
    })
  })

  it('respects explicit override and fails closed when explicit path is missing', () => {
    const customAgy = join(root, 'custom', 'agy')
    createExecutable(customAgy)

    const catalog: HarnessCatalogReader = {
      get: () => ({
        id: 'acp-antigravity',
        runtimeSource: 'external',
        enabled: true,
        state: 'ready',
        requiresAuth: false,
      }),
    }

    const resolved = resolveAntigravityRuntime(catalog, {
      homeDir: root,
      platform: 'darwin',
      override: { command: customAgy },
    })
    expect(resolved).toEqual({
      command: customAgy,
      executablePath: customAgy,
      args: ['acp'],
      source: 'explicit',
    })

    const missing = resolveAntigravityRuntime(catalog, {
      homeDir: root,
      platform: 'darwin',
      override: { command: join(root, 'does-not-exist', 'agy') },
    })
    expect(missing).toBeNull()
  })

  it('enableAcpAntigravity marks ready when found and missing when not found', () => {
    const customAgy = join(root, 'bin', 'agy')
    createExecutable(customAgy)

    let lastPatch: Record<string, unknown> = {}
    const fakeManager = {
      update: (_id: string, patch: Record<string, unknown>) => {
        lastPatch = patch
        return {
          id: 'acp-antigravity',
          runtimeSource: 'external',
          enabled: true,
          state: patch.state,
          command: patch.command ?? undefined,
          requiresAuth: false,
        }
      },
    } as unknown as HarnessManager

    const readyStatus = enableAcpAntigravity(fakeManager, {
      command: customAgy,
      args: [],
    })
    expect(readyStatus.state).toBe('ready')
    expect(readyStatus.command).toBe(customAgy)
    expect(JSON.parse(String(lastPatch.configJson))).toMatchObject({
      command: customAgy,
      commandSource: 'explicit',
      args: ['acp'],
      usesDefaultArgs: true,
    })

    const missingStatus = enableAcpAntigravity(fakeManager, {
      command: join(root, 'missing-agy'),
      args: [],
    })
    expect(missingStatus.state).toBe('missing')
    expect(lastPatch.diagnosticCode).toBe('not_found')
  })
})
