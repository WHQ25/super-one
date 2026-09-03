import { createServer, type Server, type Socket } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEV_HELPER_BUNDLE_ID,
  expectedHelperBundleId,
  MacosHelperClient,
  releaseHelperBundleId,
} from './macos-helper-client'

const cleanup: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

async function startFakeHelper(bundleId: string): Promise<{
  socketPath: string
  methods: string[]
}> {
  // Keep this test headless: the socket server emulates the native helper and
  // no desktop application is launched.
  const root = mkdtempSync(join(tmpdir(), 'superone-cu-client-'))
  const socketPath = join(root, 'helper.sock')
  const clients = new Set<Socket>()
  const methods: string[] = []
  const server: Server = createServer((socket) => {
    clients.add(socket)
    socket.on('close', () => clients.delete(socket))
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        const request = JSON.parse(line) as { id: string; method: string }
        methods.push(request.method)
        const result = request.method === 'doctor'
          ? {
              accessibility: 'granted',
              screenRecording: 'granted',
              bundleId,
              bundlePath: '/tmp/Fake Computer Use.app',
              pid: 123,
            }
          : { ok: true }
        socket.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`)
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  cleanup.push(async () => {
    for (const client of clients) client.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  })
  return { socketPath, methods }
}

describe('MacosHelperClient identity handshake', () => {
  it('accepts the matching helper and registers the current host', async () => {
    const fake = await startFakeHelper(DEV_HELPER_BUNDLE_ID)
    const client = new MacosHelperClient(fake.socketPath, null, 'dev')
    cleanup.push(() => client.close())

    await client.ensureConnected()

    expect(fake.methods).toEqual(['doctor', 'set_host'])
  })

  it('rejects a helper from the other build variant', async () => {
    // The expected id is passed rather than derived: `variantId()` reports
    // `dev` in an unpackaged process, so `releaseHelperBundleId()` returns the
    // dev id and "release client meets dev helper" cannot be built here. The
    // other half of the guarantee -- that each variant declares a DISTINCT
    // computerUseBundleId -- is pinned in variant.test.ts.
    const otherVariantId = 'com.superone.computer-use.alpha'
    expect(otherVariantId).not.toBe(DEV_HELPER_BUNDLE_ID)

    const fake = await startFakeHelper(DEV_HELPER_BUNDLE_ID)
    const client = new MacosHelperClient(fake.socketPath, null, 'release', otherVariantId)
    cleanup.push(() => client.close())

    await expect(client.ensureConnected()).rejects.toThrow(
      `expected ${otherVariantId}, got ${DEV_HELPER_BUNDLE_ID}`,
    )
    // Rejected before set_host: a foreign helper must never be told to drive
    // this process.
    expect(fake.methods).toEqual(['doctor'])
  })

  it('demands this variant’s own helper when no id is injected', () => {
    // Guards the default that production actually uses.
    expect(expectedHelperBundleId('release')).toBe(releaseHelperBundleId())
    expect(expectedHelperBundleId('dev')).toBe(DEV_HELPER_BUNDLE_ID)
  })
})
