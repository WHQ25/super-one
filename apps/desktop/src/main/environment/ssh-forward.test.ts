import { describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import { buildSshLocalForwardArgs, findFreePort, waitForLocalPort } from './ssh-forward'

describe('ssh-forward', () => {
  it('includes keepalive options on local-forward argv', () => {
    const args = buildSshLocalForwardArgs({
      localPort: 41234,
      remotePort: 7788,
      destination: 'user@host',
      extraArgs: ['-i', '/tmp/key'],
    })
    expect(args).toEqual([
      '-N',
      '-L',
      '41234:127.0.0.1:7788',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'BatchMode=yes',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=3',
      '-i',
      '/tmp/key',
      'user@host',
    ])
  })

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
