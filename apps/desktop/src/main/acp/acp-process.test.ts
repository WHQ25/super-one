import { describe, it, expect, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { spawnAcpProcess } from './acp-process'

/**
 * Use real node child processes so we exercise the SIGTERM→SIGKILL path
 * without mocking stream plumbing that ndJsonStream depends on.
 */
function nodeLaunch(script: string) {
  return {
    agentId: 'test',
    command: process.execPath,
    args: ['-e', script],
    env: {},
    cwd: process.cwd(),
  }
}

async function waitForReady(child: { stderr: NodeJS.ReadableStream | null }, token = 'ready'): Promise<void> {
  const stderr = child.stderr
  if (!stderr) throw new Error('missing stderr')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child never became ready')), 5000)
    const onData = (chunk: Buffer | string) => {
      if (String(chunk).includes(token)) {
        clearTimeout(timer)
        stderr.off('data', onData)
        resolve()
      }
    }
    stderr.on('data', onData)
  })
}

describe('spawnAcpProcess kill escalation', () => {
  it('escalates to SIGKILL when the agent ignores SIGTERM', async () => {
    const handle = spawnAcpProcess(nodeLaunch(`
      process.on('SIGTERM', () => {});
      process.stderr.write('ready\\n');
      setInterval(() => {}, 60_000);
    `))

    await waitForReady(handle.child)
    const closed = handle.closed
    await handle.kill()
    const info = await closed
    expect(info.signal).toBe('SIGKILL')
  }, 10_000)

  it('stops on SIGTERM when the agent exits cleanly', async () => {
    const handle = spawnAcpProcess(nodeLaunch(`
      process.stderr.write('ready\\n');
      setInterval(() => {}, 60_000);
    `))

    await waitForReady(handle.child)
    const closed = handle.closed
    await handle.kill()
    const info = await closed
    // Node exits on SIGTERM by default
    expect(info.signal).toBe('SIGTERM')
  }, 10_000)
})
