import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({ default: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } }))

const { assertNodeIdentity, withDeadline } = await import('./node-connection-manager')

describe('wake probe deadlines', () => {
  let server: Server | null = null
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    server = null
  })

  it('withDeadline rejects a probe that outlives the deadline', async () => {
    await expect(withDeadline(new Promise(() => {}), 20)).rejects.toThrow('timed out after 20ms')
  })

  it('withDeadline leaves the periodic probe on its own deadline', async () => {
    await expect(withDeadline(Promise.resolve('ok'), undefined)).resolves.toBe('ok')
  })

  it('assertNodeIdentity honours a short timeout on a silent tunnel', async () => {
    // Accepts the connection and never answers, like a tunnel left on a dead network.
    server = createServer(() => {})
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const started = Date.now()
    await expect(
      assertNodeIdentity(
        `http://127.0.0.1:${port}`,
        { environmentId: 'env', nodePublicKeyFingerprint: 'fp' },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow(/timed out after 50ms/)
    expect(Date.now() - started).toBeLessThan(2_000)
    server.closeAllConnections()
  })
})
