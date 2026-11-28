import { describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import {
  buildOneShotMultiplexArgs,
  buildSshLocalForwardArgs,
  findFreePort,
  userOwnsMultiplexing,
  waitForLocalPort,
} from './ssh-forward'

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
      'ConnectTimeout=30',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=3',
      '-i',
      '/tmp/key',
      'user@host',
    ])
  })

  it('never puts the forward on a shared multiplexing master', () => {
    const args = buildSshLocalForwardArgs({ localPort: 1, remotePort: 2, destination: 'h' })
    expect(args.join(' ')).not.toMatch(/Control/)
  })

  it('builds a persisted one-shot multiplexing master under the given dir', () => {
    expect(buildOneShotMultiplexArgs('/home/u/.superone/ssh-mux')).toEqual([
      '-o',
      'ControlMaster=auto',
      '-o',
      'ControlPath=/home/u/.superone/ssh-mux/%C',
      '-o',
      'ControlPersist=60',
    ])
  })

  it('leaves multiplexing to a user ControlPath and takes it otherwise', () => {
    expect(userOwnsMultiplexing('user u\ncontrolmaster auto\ncontrolpath ~/.ssh/cm-%C\n')).toBe(true)
    expect(userOwnsMultiplexing('user u\ncontrolmaster false\ncontrolpath none\n')).toBe(false)
    expect(userOwnsMultiplexing('user u\ncontrolmaster false\n')).toBe(false)
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
