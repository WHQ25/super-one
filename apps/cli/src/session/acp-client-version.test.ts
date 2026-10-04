import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessCatalogReader } from '@superone/runtime/harness'

const mocks = vi.hoisted(() => ({
  createAcpTurnRunner: vi.fn(() => async () => ({ text: '' })),
}))

vi.mock('@superone/acp', () => ({
  createAcpTurnRunner: mocks.createAcpTurnRunner,
  createSimulatedAcpTurnRunner: vi.fn(),
}))

import { createAcpOpenCodeProductionRouter } from './harness-runners'

const dirs: string[] = []

function executable(): string {
  const dir = mkdtempSync(join(tmpdir(), 'grok-launch-'))
  dirs.push(dir)
  const command = join(dir, 'grok')
  writeFileSync(command, '#!/bin/sh\nexit 0\n')
  chmodSync(command, 0o755)
  return command
}

describe('ACP production client version', () => {
  const previous = process.env.SUPERONE_CLI_VERSION

  beforeEach(() => {
    mocks.createAcpTurnRunner.mockClear()
    process.env.SUPERONE_CLI_VERSION = '9.9.9'
  })

  afterEach(() => {
    if (previous === undefined) delete process.env.SUPERONE_CLI_VERSION
    else process.env.SUPERONE_CLI_VERSION = previous
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  async function acpTurn(router: ReturnType<typeof createAcpOpenCodeProductionRouter>) {
    await router({ session: { harnessId: 'acp' } } as never)
  }

  it('passes the CLI release version into the ACP runner on the turn', async () => {
    const router = createAcpOpenCodeProductionRouter({})
    expect(mocks.createAcpTurnRunner).not.toHaveBeenCalled()
    await acpTurn(router)
    expect(mocks.createAcpTurnRunner).toHaveBeenCalledWith(expect.objectContaining({
      clientVersion: '9.9.9',
    }))
  })

  it('reads a grok launch that appears after the router is constructed', async () => {
    const first = executable()
    const second = executable()
    let enabled = false
    let command: string | undefined
    let args = ['agent', 'stdio']
    const harnesses: HarnessCatalogReader = {
      get: () => ({
        id: 'acp-grok',
        runtimeSource: 'external',
        enabled,
        state: enabled ? 'ready' : 'disabled',
        command,
        requiresAuth: false,
      }),
      getExternalLaunchConfig: () => (command ? { command, args } : {}),
    }
    const router = createAcpOpenCodeProductionRouter({ harnesses })
    await acpTurn(router)
    expect(mocks.createAcpTurnRunner).toHaveBeenLastCalledWith(expect.objectContaining({
      binaryPath: null,
    }))

    enabled = true
    command = first
    await acpTurn(router)
    expect(mocks.createAcpTurnRunner).toHaveBeenLastCalledWith(expect.objectContaining({
      binaryPath: first,
      args: ['agent', 'stdio'],
      agentId: 'grok-build',
      clientVersion: '9.9.9',
    }))

    command = second
    args = ['agent', 'stdio', '--fresh']
    await acpTurn(router)
    expect(mocks.createAcpTurnRunner).toHaveBeenLastCalledWith(expect.objectContaining({
      binaryPath: second,
      args: ['agent', 'stdio', '--fresh'],
      agentId: 'grok-build',
    }))
  })
})
