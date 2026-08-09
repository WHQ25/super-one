import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import {
  buildRemoteInstallCommands,
  buildBootstrapCommand,
  buildRemoteRestartCommand,
  extractJsonObject,
  shellQuote,
  waitForSshForwardHealth,
} from './ssh-bootstrap'
import { findFreePort } from './ssh-forward'

describe('ssh-bootstrap helpers', () => {
  it('extracts pairing JSON from noisy ssh stdout without logging secrets elsewhere', () => {
    const token = 'super-secret-pair-token'
    const stdout = [
      'Welcome to Ubuntu',
      'Last login: ...',
      JSON.stringify({
        environmentId: 'env-abc',
        expiresAt: 123,
        pairingToken: token,
      }),
    ].join('\n')
    const parsed = extractJsonObject(stdout)
    expect(parsed).toEqual({
      environmentId: 'env-abc',
      expiresAt: 123,
      pairingToken: token,
    })
  })

  it('quotes unsafe shell segments', () => {
    expect(shellQuote('/opt/superone/bin')).toBe('/opt/superone/bin')
    expect(shellQuote("path with 'quote")).toContain(`'\\''`)
  })

  it('builds install + pair command sequence for remote orchestration', () => {
    const cmds = buildRemoteInstallCommands({
      remoteExec: '/opt/superone/superone',
      nodeHome: '/home/u/.superone/node',
      remotePort: 7788,
    })
    expect(cmds.some((c) => c.includes('install-systemd'))).toBe(true)
    expect(cmds.some((c) => c.includes('pair-create'))).toBe(true)
    expect(cmds.join('\n')).not.toMatch(/pairingToken=/)
  })

  it('batches remote bootstrap operations into one command', () => {
    const command = buildBootstrapCommand({
      remoteExec: '/home/u/.local/bin/superone',
      remoteNodeHome: '/home/u/.superone/node',
      remotePort: 7788,
      nodeBinDir: '/home/u/.nvm/versions/node/v22/bin',
    })
    expect(command).toContain('export PATH=')
    expect(command).toContain('mkdir -p')
    expect(command).toContain('while [ "$i" -lt 50 ]')
    expect(command).toContain('pair-create')
    expect(command.split(' && ').length).toBeGreaterThan(3)
  })

  it('stops the old node before starting the upgraded one', () => {
    const command = buildRemoteRestartCommand({
      remoteExec: '/home/u/.local/bin/superone',
      remoteNodeHome: '/home/u/.superone/node',
      remotePort: 7788,
      nodeBinDir: '/home/u/.nvm/versions/node/v22/bin',
    })

    // Order is the whole point: npm swaps the files, but a still-running old
    // process keeps serving until it is taken down.
    const termAt = command.indexOf('kill -TERM')
    const startAt = command.indexOf('nohup')
    expect(termAt).toBeGreaterThan(-1)
    expect(startAt).toBeGreaterThan(termAt)
    // Wait for process exit, not only health-down (avoids EADDRINUSE / SQLITE_BUSY).
    expect(command).toContain('alive=0')
    expect(command).toContain('kill -9')
    // Do not signal the remote SSH shell whose argv embeds the same pattern.
    expect(command).toContain('[ "$pid" = "$$" ]')
    // Free the listen port when argv does not match (stale unit / flags).
    expect(command).toContain('lsof -tiTCP:7788')
    // Scoped to this node home so a second node on the host survives.
    expect(command).toContain('start --foreground --home /home/u/.superone/node')
    // Both supervision styles this repo produces.
    expect(command).toContain('systemctl --user stop superone.service')
    expect(command).toContain('systemctl --user start superone.service')
    // Longer cold-start window + diagnostics on failure.
    expect(command).toContain('while [ "$i" -lt 150 ]')
    expect(command).toContain('upgrade.log')
    expect(command).toContain('export PATH=')
    expect(command).toContain('SUPERONE_RESTART_OK')
  })

  it('waits until a delayed SSH-forwarded health endpoint is ready', async () => {
    const port = await findFreePort()
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    const wait = waitForSshForwardHealth(`http://127.0.0.1:${port}`, {
      timeoutMs: 1_000,
      retryDelayMs: 10,
      requestTimeoutMs: 100,
    })
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
