import { describe, expect, it, vi } from 'vitest'
import type { IosSimulatorDevice } from '@superone/shared/ios-simulator'
import {
  listDeviceCatalog,
  type DeviceEntry,
  type DeviceKindSummary,
  type DeviceModelSummary,
} from './device-catalog'
import {
  IosSimulatorDevicePort,
  type IosSimulatorCatalogSource,
} from '../ios-simulator/device-port'
import type { DeviceRecentsPort } from './device-recents'

function device(overrides: Partial<IosSimulatorDevice> & { udid: string; name: string }): IosSimulatorDevice {
  return {
    deviceTypeIdentifier: `com.apple.CoreSimulator.SimDeviceType.${overrides.name.replace(/ /g, '-')}`,
    runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-4',
    runtimeName: 'iOS 26.4',
    state: overrides.booted ? 'Booted' : 'Shutdown',
    booted: false,
    available: true,
    ownedBySuperOne: false,
    ...overrides,
  }
}

function onRuntime(base: IosSimulatorDevice, version: string, udid: string): IosSimulatorDevice {
  return {
    ...base,
    udid,
    runtimeIdentifier: `com.apple.CoreSimulator.SimRuntime.iOS-${version.replace('.', '-')}`,
    runtimeName: `iOS ${version}`,
  }
}

/**
 * The manager as the iOS port sees it. Wrapped in the REAL port rather than faking
 * the neutral one, so these also cover the classification that turns a simulator into
 * a DeviceDescriptor -- which is where the tiers get their kind and model from.
 */
function source(catalog: IosSimulatorDevice[]): IosSimulatorCatalogSource {
  return {
    async listDevices() { return catalog },
    async boot() { throw new Error('not used') },
  }
}

function ports(catalog: IosSimulatorDevice[]) {
  return [new IosSimulatorDevicePort(source(catalog))]
}

function recents(udids: string[]): DeviceRecentsPort {
  return { read: () => udids, remember: () => {} }
}

/** One model on every runtime — the shape that makes the flat catalog unaffordable. */
function fullMatrix(): IosSimulatorDevice[] {
  const models = ['iPhone 17', 'iPhone 17 Pro Max', 'iPad Pro 13-inch']
  return models.flatMap((name) =>
    ['26.4', '18.0', '17.0'].map((version) =>
      onRuntime(device({ udid: `${name}-${version}`, name }), version, `${name}-${version}`)))
}

describe('listDeviceCatalog overview', () => {
  it('answers with what is running and what the project used, not the machine', async () => {
    // 9 devices exist; the overview names 2 and counts the rest. This is the whole
    // point of the tier — a real machine has ~120, which is ~4k tokens flattened.
    const catalog = fullMatrix()
    catalog[0]!.booted = true
    const result = await listDeviceCatalog({
      sessionId: 's1',
      ports: ports(catalog),
      recents: recents(['iPad Pro 13-inch-18.0']),
    })

    expect((result.running as DeviceEntry[]).map((entry) => entry.id)).toEqual(['ios-sim:iPhone 17-26.4'])
    expect((result.recent as DeviceEntry[]).map((entry) => entry.id)).toEqual(['ios-sim:iPad Pro 13-inch-18.0'])
    expect(result.total).toBe(9)
    expect(result.groups).toBeUndefined()
  })

  it('counts models per kind rather than listing the cartesian product', async () => {
    const kinds = (await listDeviceCatalog({
      sessionId: 's1',
      ports: ports(fullMatrix()),
    })).kinds as DeviceKindSummary[]

    expect(kinds).toEqual([
      { kind: 'iphone', name: 'iPhone', models: 2, devices: 6 },
      { kind: 'ipad', name: 'iPad', models: 1, devices: 3 },
    ])
  })

  it('never offers a recent device twice, and drops one that was deleted', async () => {
    const catalog = fullMatrix()
    catalog[0]!.booted = true
    const result = await listDeviceCatalog({
      sessionId: 's1',
      ports: ports(catalog),
      // The running one, plus a udid that no longer exists on this machine.
      recents: recents(['iPhone 17-26.4', 'deleted-udid']),
    })

    expect(result.recent).toBeUndefined()
    expect((result.running as DeviceEntry[]).map((entry) => entry.id)).toEqual(['ios-sim:iPhone 17-26.4'])
  })

  it('separates a device another session holds from the one this session controls', async () => {
    const mine = device({ udid: 'mine', name: 'iPhone 16', booted: true, boundSessionId: 's1' })
    const result = await listDeviceCatalog({
      sessionId: 's1',
      ports: ports([
        mine,
        device({ udid: 'theirs', name: 'iPad Pro 13-inch', booted: true, boundSessionId: 's2' }),
      ]),
    })

    const byId = new Map((result.running as DeviceEntry[]).map((entry) => [entry.id, entry]))
    expect(byId.get('ios-sim:mine')?.controlled).toBe(true)
    expect(byId.get('ios-sim:mine')?.busy).toBeUndefined()
    expect(byId.get('ios-sim:theirs')?.busy).toBe(true)
    expect(byId.get('ios-sim:theirs')?.controlled).toBeUndefined()
    expect(result.controlled).toMatchObject([{ id: 'ios-sim:mine' }])
  })

  it('enumerates the machine exactly once, however many tiers read the answer', async () => {
    // `simctl list devices --json` is a process spawn against CoreSimulatorService.
    // Asking a port which device the session controls used to be a SECOND question,
    // and it spawned a second one; ownership is stamped onto every row as it is
    // listed, so the answer was already in hand.
    const backing = source(fullMatrix())
    const listDevices = vi.spyOn(backing, 'listDevices')

    await listDeviceCatalog({ sessionId: 's1', ports: [new IosSimulatorDevicePort(backing)] })

    expect(listDevices).toHaveBeenCalledOnce()
  })

  it('lists every device the session holds, not just the first', async () => {
    // The case the whole multi-device change exists for: one conversation driving a
    // client build on one simulator and a merchant build on another.
    const result = await listDeviceCatalog({
      sessionId: 's1',
      ports: ports([
        device({ udid: 'client', name: 'iPhone 16', booted: true, boundSessionId: 's1' }),
        device({ udid: 'merchant', name: 'iPhone 17', booted: true, boundSessionId: 's1' }),
      ]),
    })

    expect(result.controlled).toMatchObject([
      { id: 'ios-sim:client' },
      { id: 'ios-sim:merchant' },
    ])
    // ...and it says so, because from here on every device_* call must name one.
    expect(String(result.note)).toMatch(/must name one|needs an explicit/)
  })

  it('hides devices whose runtime is not installed', async () => {
    const result = await listDeviceCatalog({
      sessionId: 's1',
      ports: ports([device({ udid: 'x', name: 'iPhone 16', available: false })]),
    })

    expect(result.kinds).toEqual([])
    expect(result.total).toBe(0)
    expect(String(result.note)).toMatch(/unavailable/)
  })

  it('names the follow-up tool when nothing is controlled yet', async () => {
    const result = await listDeviceCatalog({
      sessionId: 's1',
      ports: ports([device({ udid: 'a', name: 'iPhone 16' })]),
    })

    expect(result.controlled).toEqual([])
    expect(String(result.note)).toMatch(/device_list|device_request_control/)
  })
})

describe('listDeviceCatalog kind tier', () => {
  it('collapses runtimes into one row per model, newest named', async () => {
    const models = (await listDeviceCatalog({
      sessionId: 's1',
      ports: ports(fullMatrix()),
      request: { kind: 'iphone' },
    })).models as DeviceModelSummary[]

    expect(models).toEqual([
      { model: 'iPhone 17', devices: 3, latest: 'iOS 26.4' },
      { model: 'iPhone 17 Pro Max', devices: 3, latest: 'iOS 26.4' },
    ])
  })

  it('reports how many of a model are already running', async () => {
    const catalog = fullMatrix()
    catalog[1]!.booted = true
    const models = (await listDeviceCatalog({
      sessionId: 's1',
      ports: ports(catalog),
      request: { kind: 'iPhone' },
    })).models as DeviceModelSummary[]

    expect(models[0]).toMatchObject({ model: 'iPhone 17', running: 1 })
  })

  it('sends an unknown kind back to the overview instead of guessing', async () => {
    const result = await listDeviceCatalog({
      sessionId: 's1',
      ports: ports(fullMatrix()),
      request: { kind: 'android' },
    })

    expect(result.models).toEqual([])
    expect(String(result.note)).toMatch(/Unknown kind/)
  })
})

describe('listDeviceCatalog model tier', () => {
  it('hands out one id per runtime, newest first', async () => {
    const result = await listDeviceCatalog({
      sessionId: 's1',
      ports: ports(fullMatrix()),
      request: { model: 'iphone 17 pro max' },
    })

    expect(result.model).toBe('iPhone 17 Pro Max')
    expect((result.devices as DeviceEntry[]).map((entry) => entry.platform))
      .toEqual(['iOS 26.4', 'iOS 18.0', 'iOS 17.0'])
    // The name is the heading here; repeating it on every row is the cost this tier exists to avoid.
    expect((result.devices as DeviceEntry[]).every((entry) => entry.name === undefined)).toBe(true)
  })

  it('keeps the name of a simulator that was renamed', async () => {
    const renamed = device({ udid: 'renamed', name: 'checkout rig' })
    renamed.deviceTypeIdentifier = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max'
    const result = await listDeviceCatalog({
      sessionId: 's1',
      ports: ports([renamed]),
      request: { model: 'iPhone 17 Pro Max' },
    })

    expect((result.devices as DeviceEntry[])[0]).toMatchObject({ id: 'ios-sim:renamed', name: 'checkout rig' })
  })

  it('says so rather than returning an empty list for a model that does not exist', async () => {
    const result = await listDeviceCatalog({
      sessionId: 's1',
      ports: ports(fullMatrix()),
      request: { model: 'Pixel 9' },
    })

    expect(result.devices).toEqual([])
    expect(String(result.note)).toMatch(/No model matches/)
  })
})
