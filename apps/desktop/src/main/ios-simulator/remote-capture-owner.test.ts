/**
 * A simulator a REMOTE session holds, captured from the desktop UI: the capture
 * runs outside any tool call, yet the file lands in that session's zone. The
 * marker the reclaim sweep reads must still name the node, or the sweep will
 * ask this desktop's database, find no row, and delete the zone while the
 * session is alive on the node.
 */
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '' }))
// The zone's delivery record: a table that cannot be read protects every zone file (R5).
vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { findDeliveryByPath } from '../db-session-deliveries'
import { collectArtifacts } from '../mcp/artifact-registry'
import { SimctlCapture } from './capture'
import { IosSimulatorManager } from './ios-simulator-manager'
import type { IosSimulatorDevice } from './types'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sim-owner-'))
  state.userData = root
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

class FakeChild extends EventEmitter {
  readonly stderr = new EventEmitter()
  kill = vi.fn(() => true)
}

function harness() {
  let booted = false
  const device = (): IosSimulatorDevice => ({
    udid: 'device-a', name: 'iPhone 17 Pro', runtime: 'iOS 26', state: booted ? 'Booted' : 'Shutdown',
    booted, available: true,
  } as IosSimulatorDevice)
  const simctl = {
    status: vi.fn(async () => ({ ok: true })),
    listDevices: vi.fn(async () => [device()]),
    listRuntimes: vi.fn(async () => []),
    listDeviceTypeBundles: vi.fn(async () => new Map<string, string>()),
    create: vi.fn(async () => 'device-a'),
    boot: vi.fn(async () => { booted = true }),
    shutdown: vi.fn(async () => { booted = false }),
    writePasteboard: vi.fn(async () => {}),
  }
  // The real capture port with the real default directory creation; only
  // `xcrun simctl` itself is replaced, by a child that writes the capture it
  // was asked for and exits cleanly.
  const capture = new SimctlCapture({
    spawnProcess: vi.fn((_bin: string, args: string[]) => {
      const child = new FakeChild()
      writeFileSync(args.at(-1)!, 'PNG')
      queueMicrotask(() => child.emit('close', 0))
      return child
    }) as never,
  })
  const manager = new IosSimulatorManager({
    simctl: simctl as never,
    capture,
    nativeFactory: vi.fn(async () => { throw new Error('no helper in this test') }),
    helperProbe: async () => null,
    attachAttempts: 1,
  })
  return { manager, power: (on: boolean) => { booted = on } }
}

describe('capturing a simulator a remote session holds', () => {
  it('keeps the zone marked for the node when the person takes the screenshot from the panel', async () => {
    const { manager, power } = harness()
    // Bound from a Host Action: the call scope names the node.
    await collectArtifacts('remote-s1', 'call-1', () => manager.bind('remote-s1', 'device-a'), 'node-1')
    power(true)
    // Captured from the UI: no scope at all.
    const shot = await manager.screenshot('device-a')
    expect(shot.path.startsWith(join(root, 'sync', 'remote-s1', 'ios-simulator', 'device-a'))).toBe(true)
    expect(existsSync(join(shot.path, '..'))).toBe(true)
    expect(readFileSync(join(root, 'sync', 'remote-s1', '.owner'), 'utf8')).toBe('node-1')
    // And the capture is a delivery to that node, sealed by the manager itself.
    expect(findDeliveryByPath('remote-s1', shot.path)).toMatchObject({ phase: 'sealed', holder: null, connectionId: 'node-1', total: 3 })
  })

  it('marks a local session as local when it bound the device from its own call', async () => {
    const { manager, power } = harness()
    await collectArtifacts('local-s1', 'call-1', () => manager.bind('local-s1', 'device-a'))
    power(true)
    const shot = await manager.screenshot('device-a')
    expect(readFileSync(join(root, 'sync', 'local-s1', '.owner'), 'utf8')).toBe('local')
    expect(findDeliveryByPath('local-s1', shot.path)).toBeNull()
  })
})
