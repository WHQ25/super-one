/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockWatchBashOutput = vi.fn()
const mockUnwatchBashOutput = vi.fn()

vi.mock('../../app', () => ({
  useAppStore: {
    getState: () => ({ currentProjectId: 'proj-remote-1' }),
  },
}))

const bashOutputs: Record<string, { content: string; finished: boolean; outputPath?: string }> = {}

vi.mock('../index', () => ({
  useChatStore: {
    setState: (fn: (s: { _bashOutputs: typeof bashOutputs }) => { _bashOutputs: typeof bashOutputs }) => {
      const next = fn({ _bashOutputs: bashOutputs })
      Object.assign(bashOutputs, next._bashOutputs)
    },
    getState: () => ({ _bashOutputs: bashOutputs }),
  },
}))

vi.stubGlobal('window', {
  app: {
    watchBashOutput: mockWatchBashOutput,
    unwatchBashOutput: mockUnwatchBashOutput,
  },
})

const {
  startBashOutputLive,
  stopBashOutputLive,
  toToolOutputRelativePath,
} = await import('./bash-output-live')

describe('toToolOutputRelativePath', () => {
  it('maps absolute paths under project temp/', () => {
    expect(toToolOutputRelativePath('/work/app', '/work/app/temp/job.output')).toBe('temp/job.output')
  })

  it('rejects paths outside project and outside temp/', () => {
    expect(toToolOutputRelativePath('/work/app', '/tmp/job.output')).toBeNull()
    expect(toToolOutputRelativePath('/work/app', '/work/app/src/a.ts')).toBeNull()
  })
})

describe('startBashOutputLive', () => {
  beforeEach(() => {
    mockWatchBashOutput.mockReset()
    mockUnwatchBashOutput.mockReset()
    for (const k of Object.keys(bashOutputs)) delete bashOutputs[k]
  })

  afterEach(() => {
    stopBashOutputLive('tool-1')
  })

  it('local project uses desktop watchBashOutput (not node RPC)', () => {
    startBashOutputLive({
      toolUseId: 'tool-1',
      outputPath: '/tmp/job.output',
      projectKey: '/Users/me/proj',
    })
    expect(mockWatchBashOutput).toHaveBeenCalledWith('tool-1', '/tmp/job.output')
  })

  it('remote project calls tailWatch port (node RPC path) instead of local fs.watch', async () => {
    const start = vi.fn().mockResolvedValue({
      watchId: 'w1',
      offset: 0,
      relativePath: 'temp/job.output',
    })
    const poll = vi
      .fn()
      .mockResolvedValueOnce({
        content: Buffer.from('line1\n').toString('base64'),
        encoding: 'base64',
        offset: 6,
        size: 6,
      })
      .mockResolvedValue({
        content: '',
        encoding: 'base64',
        offset: 6,
        size: 6,
      })
    const stop = vi.fn().mockResolvedValue({ ok: true })

    startBashOutputLive({
      toolUseId: 'tool-1',
      outputPath: '/work/app/temp/job.output',
      projectKey: 'remote:conn-1:/work/app',
      projectId: 'proj-remote-1',
      environmentId: 'env-node-1',
      port: { start, poll, stop },
      pollIntervalMs: 20,
    })

    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledWith({
        project: { environmentId: 'env-node-1', projectId: 'proj-remote-1' },
        relativePath: 'temp/job.output',
        offset: 0,
      })
    })
    expect(mockWatchBashOutput).not.toHaveBeenCalled()

    await vi.waitFor(() => {
      expect(poll).toHaveBeenCalledWith({ watchId: 'w1' })
      expect(bashOutputs['tool-1']?.content).toContain('line1')
    })

    stopBashOutputLive('tool-1')
    await vi.waitFor(() => {
      expect(stop).toHaveBeenCalledWith({ watchId: 'w1' })
    })
  })

  it('remote path outside project/temp finishes without local watch', async () => {
    const start = vi.fn()
    startBashOutputLive({
      toolUseId: 'tool-1',
      outputPath: '/tmp/outside.output',
      projectKey: 'remote:conn-1:/work/app',
      projectId: 'proj-remote-1',
      environmentId: 'env-1',
      port: { start, poll: vi.fn(), stop: vi.fn() },
    })
    expect(start).not.toHaveBeenCalled()
    expect(mockWatchBashOutput).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(bashOutputs['tool-1']?.finished).toBe(true)
    })
  })
})
