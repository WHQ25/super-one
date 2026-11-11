import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getExternalCliInstallSpec,
  isExternalCliHarnessId,
  type ExternalCliInstallEvent,
} from '@superone/shared/environment'
import {
  installExternalHarnessCli,
  resetExternalCliInstallerForTests,
} from './external-cli-installer'

function createFakeChildProcess() {
  const proc = new EventEmitter() as ChildProcess
  proc.stdout = new PassThrough()
  proc.stderr = new PassThrough()
  proc.stdin = new PassThrough()
  return proc
}

afterEach(() => {
  resetExternalCliInstallerForTests()
})

describe('external CLI install specs', () => {
  it('recognizes only the external CLI harnesses', () => {
    expect(isExternalCliHarnessId('acp-grok')).toBe(true)
    expect(isExternalCliHarnessId('acp-antigravity')).toBe(true)
    expect(isExternalCliHarnessId('opencode')).toBe(true)
    expect(isExternalCliHarnessId('claude')).toBe(false)
    expect(isExternalCliHarnessId('codex')).toBe(false)
    expect(isExternalCliHarnessId(null)).toBe(false)
  })

  it('returns official bash commands on macOS/Linux and PowerShell commands on Windows', () => {
    expect(getExternalCliInstallSpec('acp-grok', 'darwin')).toEqual({
      harnessId: 'acp-grok',
      binaryName: 'grok',
      language: 'bash',
      command: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    })
    expect(getExternalCliInstallSpec('acp-grok', 'win32')).toEqual({
      harnessId: 'acp-grok',
      binaryName: 'grok',
      language: 'powershell',
      command: 'irm https://x.ai/cli/install.ps1 | iex',
    })
    expect(getExternalCliInstallSpec('acp-antigravity', 'linux')).toEqual({
      harnessId: 'acp-antigravity',
      binaryName: 'agy',
      language: 'bash',
      command: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    })
    expect(getExternalCliInstallSpec('acp-antigravity', 'win32')).toEqual({
      harnessId: 'acp-antigravity',
      binaryName: 'agy',
      language: 'powershell',
      command: 'irm https://antigravity.google/cli/install.ps1 | iex',
    })
    expect(getExternalCliInstallSpec('opencode', 'darwin')).toEqual({
      harnessId: 'opencode',
      binaryName: 'opencode',
      language: 'bash',
      command: 'curl -fsSL https://opencode.ai/v2/install | bash',
    })
    expect(getExternalCliInstallSpec('opencode', 'win32')).toEqual({
      harnessId: 'opencode',
      binaryName: 'opencode',
      language: 'powershell',
      command: 'npm install -g @opencode/cli',
    })
  })
})

describe('installExternalHarnessCli', () => {
  it('rejects unsupported harness ids', async () => {
    await expect(installExternalHarnessCli('claude')).rejects.toThrow(
      /unsupported external CLI harness/,
    )
  })

  it('spawns the allowlisted installer, streams output, refreshes PATH, and enables the harness', async () => {
    const events: ExternalCliInstallEvent[] = []
    const proc = createFakeChildProcess()
    const spawnProcess = vi.fn().mockReturnValue(proc)
    const refreshPath = vi.fn().mockResolvedValue(undefined)
    const enableHarness = vi.fn().mockResolvedValue({
      id: 'acp-antigravity',
      enabled: true,
      state: 'ready',
      runtimeSource: 'external',
      requiresAuth: false,
      command: '/Users/test/.local/bin/agy',
    })
    const refreshAcpAgents = vi.fn().mockResolvedValue(undefined)

    const promise = installExternalHarnessCli('acp-antigravity', {
      platform: 'darwin',
      cwd: '/Users/test',
      ensurePath: async () => undefined,
      refreshPath,
      spawnProcess,
      enableHarness,
      refreshAcpAgents,
      emit: (e) => events.push(e),
    })

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1))
    expect(spawnProcess).toHaveBeenCalledWith(
      'bash',
      ['-c', 'curl -fsSL https://antigravity.google/cli/install.sh | bash'],
      expect.objectContaining({ cwd: '/Users/test' }),
    )

    proc.stdout?.write('Downloading agy...\n')
    proc.stderr?.write('Installed to ~/.local/bin/agy\n')
    proc.emit('close', 0)

    const result = await promise
    expect(result).toMatchObject({
      ok: true,
      harnessId: 'acp-antigravity',
      exitCode: 0,
    })
    expect(refreshPath).toHaveBeenCalledTimes(1)
    expect(enableHarness).toHaveBeenCalledWith('acp-antigravity')
    expect(refreshAcpAgents).toHaveBeenCalledTimes(1)
    expect(events).toEqual([
      { harnessId: 'acp-antigravity', phase: 'start' },
      { harnessId: 'acp-antigravity', phase: 'output', data: 'Downloading agy...\n' },
      { harnessId: 'acp-antigravity', phase: 'output', data: 'Installed to ~/.local/bin/agy\n' },
      { harnessId: 'acp-antigravity', phase: 'done', exitCode: 0 },
    ])
  })

  it('uses PowerShell on win32 and coalesces concurrent calls for the same harness', async () => {
    const proc = createFakeChildProcess()
    const spawnProcess = vi.fn().mockReturnValue(proc)

    const p1 = installExternalHarnessCli('acp-grok', {
      platform: 'win32',
      cwd: 'C:\\Users\\test',
      ensurePath: async () => undefined,
      refreshPath: async () => undefined,
      spawnProcess,
      enableHarness: async () => ({
        id: 'acp-grok',
        enabled: true,
        state: 'ready',
        runtimeSource: 'external',
        requiresAuth: true,
        command: 'C:\\Users\\test\\.grok\\bin\\grok.exe',
      }),
      refreshAcpAgents: async () => undefined,
      emit: () => undefined,
    })
    const p2 = installExternalHarnessCli('acp-grok')

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1))
    expect(spawnProcess).toHaveBeenCalledWith(
      'powershell',
      ['-NoProfile', '-Command', 'irm https://x.ai/cli/install.ps1 | iex'],
      expect.objectContaining({ cwd: 'C:\\Users\\test' }),
    )

    proc.emit('close', 0)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
  })

  it('reports failure on non-zero exit code without marking ready', async () => {
    const events: ExternalCliInstallEvent[] = []
    const proc = createFakeChildProcess()
    const enableHarness = vi.fn()

    const promise = installExternalHarnessCli('opencode', {
      platform: 'linux',
      cwd: '/home/test',
      ensurePath: async () => undefined,
      refreshPath: async () => undefined,
      spawnProcess: () => proc,
      enableHarness,
      refreshAcpAgents: async () => undefined,
      emit: (e) => events.push(e),
    })

    await vi.waitFor(() => expect(events).toHaveLength(1))
    proc.stderr?.write('curl: (6) Could not resolve host\n')
    proc.emit('close', 6)

    const result = await promise
    expect(result).toEqual({
      ok: false,
      harnessId: 'opencode',
      exitCode: 6,
    })
    expect(enableHarness).not.toHaveBeenCalled()
    expect(events.at(-1)).toEqual({
      harnessId: 'opencode',
      phase: 'error',
      exitCode: 6,
    })
  })
})
