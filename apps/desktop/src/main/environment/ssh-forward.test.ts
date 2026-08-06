import { describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import { findFreePort, waitForLocalPort } from './ssh-forward'

describe('ssh-forward', () => {
  it('allocates an ephemeral free local port', async () => {
    const a = await findFreePort()
    const b = await findFreePort()
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(0)
    // May collide rarely; at least both are valid ports
    expect(a).toBeLessThan(65536)
  })

  it('waits for a delayed local forward listener instead of using a fixed delay', async () => {
    const port = await findFreePort()
    const server = createServer()
    const wait = waitForLocalPort(port, 1_000)
    await new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', resolve)
      }, 50)
    })
    try {
      await wait
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})
