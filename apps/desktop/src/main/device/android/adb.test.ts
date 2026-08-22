import { describe, expect, it, vi } from 'vitest'
import { Adb, AdbError, parseAdbDevices, type AdbResult, type RunAdb } from './adb'

/** Verbatim from `adb devices -l` against a booted AVD on this machine. */
const ONE_EMULATOR = `List of devices attached
emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:2

`

function runner(result: Partial<AdbResult> = {}): { run: RunAdb; calls: string[][] } {
  const calls: string[][] = []
  const run: RunAdb = async (args) => {
    calls.push([...args])
    return { stdout: Buffer.from(''), stderr: '', code: 0, ...result }
  }
  return { run, calls }
}

describe('parseAdbDevices', () => {
  it('reads the serial and the long-format fields off a booted emulator', () => {
    expect(parseAdbDevices(ONE_EMULATOR)).toEqual([{
      serial: 'emulator-5554',
      state: 'device',
      properties: {
        product: 'sdk_gphone64_arm64',
        model: 'sdk_gphone64_arm64',
        device: 'emu64a',
        transport_id: '2',
      },
    }])
  })

  it('skips the daemon chatter adb prints on stdout when it starts its own server', () => {
    // Not an error and not a device, but indistinguishable from one to anything that
    // just splits lines — and it only appears on the FIRST call after a reboot, so it
    // is exactly the kind of thing that passes locally and breaks on a fresh machine.
    const noisy = `* daemon not running; starting now at tcp:5037
* daemon started successfully
${ONE_EMULATOR}`
    expect(parseAdbDevices(noisy).map((device) => device.serial)).toEqual(['emulator-5554'])
  })

  it('keeps a phone whose debugging prompt has not been accepted, and says so', () => {
    // Dropping it would be worse than surfacing it: the user needs to be told to tap
    // the dialog, and a device that silently does not exist gives them nothing to fix.
    const devices = parseAdbDevices(`List of devices attached
39061FDJH00BQZ         unauthorized usb:1234
`)
    expect(devices).toEqual([
      { serial: '39061FDJH00BQZ', state: 'unauthorized', properties: { usb: '1234' } },
    ])
  })

  it('reports a state it does not recognize rather than guessing it is usable', () => {
    const [device] = parseAdbDevices(`List of devices attached
emulator-5554          sideload
`)
    expect(device?.state).toBe('unknown')
  })

  it('answers with nothing when no device is attached', () => {
    expect(parseAdbDevices('List of devices attached\n\n')).toEqual([])
  })
})

describe('Adb command shape', () => {
  it('reads binary output through exec-out, never the shell transport', async () => {
    // The shell transport translates LF to CRLF, which corrupts every PNG that goes
    // through it. This is the assertion that keeps a screenshot readable.
    const { run, calls } = runner({ stdout: Buffer.from([0x89, 0x50, 0x4e, 0x47]) })
    const bytes = await new Adb(run).execOut('emulator-5554', ['screencap', '-p'])

    expect(calls[0]).toEqual(['-s', 'emulator-5554', 'exec-out', 'screencap', '-p'])
    expect([...bytes]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('passes shell arguments as a list so a path with a space survives', async () => {
    const { run, calls } = runner()
    await new Adb(run).shell('emulator-5554', ['am', 'start', '-n', 'com.x/.Main Activity'])

    expect(calls[0]).toEqual([
      '-s', 'emulator-5554', 'shell', 'am', 'start', '-n', 'com.x/.Main Activity',
    ])
  })

  it('scopes every command to a serial, so a second attached device cannot receive it', async () => {
    const { run, calls } = runner({ stdout: Buffer.from('1\n') })
    await new Adb(run).getProp('emulator-5554', 'sys.boot_completed')

    expect(calls[0]?.slice(0, 2)).toEqual(['-s', 'emulator-5554'])
  })
})

describe('Adb.forward', () => {
  it('asks adb to pick the port and reads back the one it chose', async () => {
    // `tcp:0` rather than a fixed number: a hard-coded port races anything else on the
    // machine, and probing for a free one ourselves reintroduces the same race.
    const { run, calls } = runner({ stdout: Buffer.from('41283\n') })
    const port = await new Adb(run).forward('emulator-5554', 'localabstract:scrcpy')

    expect(port).toBe(41283)
    expect(calls[0]).toEqual([
      '-s', 'emulator-5554', 'forward', 'tcp:0', 'localabstract:scrcpy',
    ])
  })

  it('refuses to return a port when adb printed nothing usable', async () => {
    const { run } = runner({ stdout: Buffer.from('') })
    await expect(new Adb(run).forward('emulator-5554', 'localabstract:scrcpy'))
      .rejects.toThrow(/no port/)
  })
})

describe('Adb failure reporting', () => {
  it('carries the stderr adb wrote into the error, since that is the whole diagnosis', async () => {
    const { run } = runner({ code: 1, stderr: 'error: device offline\n' })
    await expect(new Adb(run).shell('emulator-5554', ['true']))
      .rejects.toThrow(/device offline/)
  })

  it('fails the device list rather than reporting an empty machine', async () => {
    // An empty list and a broken adb look identical downstream, and only one of them
    // should send the user to Android Studio to create an AVD.
    const { run } = runner({ code: 1, stderr: 'adb: command not found' })
    await expect(new Adb(run).devices()).rejects.toBeInstanceOf(AdbError)
  })

  it('swallows a failed forward removal, which is cleanup and not a result', async () => {
    const { run } = runner({ code: 1, stderr: 'not found' })
    await expect(new Adb(run).removeForward('emulator-5554', 41283)).resolves.toBeUndefined()
  })
})

describe('Adb cancellation', () => {
  it('passes the caller signal down so an interrupted turn kills the subprocess', async () => {
    const seen: Array<AbortSignal | undefined> = []
    const run: RunAdb = async (_args, options) => {
      seen.push(options?.signal)
      return { stdout: Buffer.from(''), stderr: '', code: 0 }
    }
    const controller = new AbortController()
    await new Adb(run).shell('emulator-5554', ['true'], controller.signal)

    expect(seen[0]).toBe(controller.signal)
  })

  it('gives every command a timeout, so a wedged device cannot hang a turn forever', async () => {
    const timeouts: Array<number | undefined> = []
    const run = vi.fn<RunAdb>(async (_args, options) => {
      timeouts.push(options?.timeoutMs)
      return { stdout: Buffer.from('x'), stderr: '', code: 0 }
    })
    const adb = new Adb(run)
    await adb.shell('emulator-5554', ['true'])
    await adb.devices()

    expect(timeouts.every((value) => typeof value === 'number' && value > 0)).toBe(true)
  })
})
