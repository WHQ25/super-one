import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { startNodeRuntime } from './runtime'

const out = process.env.HEALTH_OUT || join(tmpdir(), 'node-health.json')
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe('health capture', () => {
  it('GET /health returns ok and environmentId', async () => {
    const nodeHome = mkdtempSync(join(tmpdir(), 'health-cap-'))
    dirs.push(nodeHome)
    const rt = await startNodeRuntime({
      nodeHome,
      bindHost: '127.0.0.1',
      // Ephemeral port: the OS picks a free one and the handle's `url` carries
      // it back, so parallel test files cannot collide.
      bindPort: 0,
      label: 'health-capture', simulatedHarness: true })
    try {
      const res = await fetch(`${rt.server.url}/health`)
      expect(res.ok).toBe(true)
      const body = (await res.json()) as { ok: boolean; environmentId: string; nodePublicKeyFingerprint: string }
      expect(body.ok).toBe(true)
      expect(body.environmentId).toBeTruthy()
      writeFileSync(out, JSON.stringify(body, null, 2))
    } finally {
      await rt.stop()
    }
  })
})
