import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Adb, type AdbResult, type RunAdb } from './adb'
import {
  AndroidScreenRecorder,
  type AndroidScreenrecordProcess,
} from './screen-recording'

function ok(text = ''): AdbResult {
  return { stdout: Buffer.from(text), stderr: '', code: 0 }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

describe('AndroidScreenRecorder', () => {
  it('keeps one recording per device, then finalizes, pulls, and removes it', async () => {
    const calls: string[][] = []
    const run: RunAdb = async (args) => {
      calls.push([...args])
      return ok(args.includes('stat') ? '512\n' : '')
    }
    const exited = deferred<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>()
    const process: AndroidScreenrecordProcess = {
      ready: Promise.resolve(),
      exited: exited.promise,
      interrupt: vi.fn(() => exited.resolve({ code: 0, signal: null, stderr: '' })),
      forceStop: vi.fn(),
    }
    const spawn = vi.fn(() => process)
    const recorder = new AndroidScreenRecorder(
      new Adb(run),
      '/sdk/platform-tools/adb',
      spawn,
    )

    const capture = await recorder.start({
      deviceId: 'android:avd:Pixel_9',
      serial: 'emulator-5554',
      deviceName: 'Pixel 9',
      captureRoot: join(tmpdir(), 'superone-android-recording-test'),
    })

    expect(recorder.isRecording('android:avd:Pixel_9')).toBe(true)
    expect(capture).toMatchObject({ kind: 'recording', fileName: expect.stringMatching(/\.mp4$/) })
    expect(spawn).toHaveBeenCalledWith(
      '/sdk/platform-tools/adb',
      'emulator-5554',
      expect.stringMatching(/^\/data\/local\/tmp\/superone-screenrecord-[\w-]+\.mp4$/),
      180,
    )
    await expect(recorder.start({
      deviceId: 'android:avd:Pixel_9',
      serial: 'emulator-5554',
      deviceName: 'Pixel 9',
      captureRoot: join(tmpdir(), 'superone-android-recording-test'),
    })).rejects.toThrow(/already recording/i)

    await expect(recorder.stop('android:avd:Pixel_9')).resolves.toEqual(capture)
    expect(process.interrupt).toHaveBeenCalledOnce()
    expect(calls).toContainEqual([
      '-s', 'emulator-5554', 'pull', expect.stringMatching(/\.mp4$/), capture.path,
    ])
    expect(calls).toContainEqual([
      '-s', 'emulator-5554', 'shell', 'rm', '-f', expect.stringMatching(/\.mp4$/),
    ])
    expect(recorder.isRecording('android:avd:Pixel_9')).toBe(false)
  })

  it('drops the session and remote file when screenrecord cannot start', async () => {
    const calls: string[][] = []
    const run: RunAdb = async (args) => {
      calls.push([...args])
      return ok()
    }
    const ready = deferred<void>()
    const process: AndroidScreenrecordProcess = {
      ready: ready.promise,
      exited: Promise.resolve({ code: 1, signal: null, stderr: 'encoder failed' }),
      interrupt: vi.fn(),
      forceStop: vi.fn(),
    }
    const spawn = vi.fn(() => process)
    const recorder = new AndroidScreenRecorder(
      new Adb(run),
      '/sdk/platform-tools/adb',
      spawn,
    )

    const starting = recorder.start({
      deviceId: 'android:phone-1',
      serial: 'phone-1',
      deviceName: 'Phone',
      captureRoot: join(tmpdir(), 'superone-android-recording-test'),
    })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())
    const failedStart = expect(starting).rejects.toThrow(/encoder failed/)
    ready.reject(new Error('screenrecord: encoder failed'))
    await failedStart

    expect(recorder.isRecording('android:phone-1')).toBe(false)
    expect(calls).toContainEqual([
      '-s', 'phone-1', 'shell', 'rm', '-f', expect.stringMatching(/\.mp4$/),
    ])
  })

  it('rejects a second start and still stops when release races startup', async () => {
    const run: RunAdb = async (args) => ok(args.includes('stat') ? '256\n' : '')
    const ready = deferred<void>()
    const exited = deferred<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>()
    const process: AndroidScreenrecordProcess = {
      ready: ready.promise,
      exited: exited.promise,
      interrupt: vi.fn(() => exited.resolve({ code: 0, signal: null, stderr: '' })),
      forceStop: vi.fn(),
    }
    const spawn = vi.fn(() => process)
    const recorder = new AndroidScreenRecorder(new Adb(run), '/sdk/adb', spawn)
    const target = {
      deviceId: 'android:phone-1',
      serial: 'phone-1',
      deviceName: 'Phone',
      captureRoot: join(tmpdir(), 'superone-android-recording-test'),
    }

    const starting = recorder.start(target)
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())
    await expect(recorder.start(target)).rejects.toThrow(/already recording/i)
    const stopping = recorder.stop(target.deviceId)
    ready.resolve()

    await expect(starting).resolves.toMatchObject({ kind: 'recording' })
    await expect(stopping).resolves.toMatchObject({ kind: 'recording' })
    expect(process.interrupt).toHaveBeenCalledOnce()
    expect(recorder.isRecording(target.deviceId)).toBe(false)
  })

  it('uses Android 14 unlimited recording without breaking legacy devices', async () => {
    const exited = deferred<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>()
    const process: AndroidScreenrecordProcess = {
      ready: Promise.resolve(),
      exited: exited.promise,
      interrupt: () => exited.resolve({ code: 0, signal: null, stderr: '' }),
      forceStop: vi.fn(),
    }
    const spawn = vi.fn(() => process)
    const run: RunAdb = async (args) => ok(args.includes('stat') ? '256\n' : '')
    const recorder = new AndroidScreenRecorder(new Adb(run), '/sdk/adb', spawn)

    await recorder.start({
      deviceId: 'android:api-36',
      serial: 'api-36',
      deviceName: 'Pixel',
      captureRoot: join(tmpdir(), 'superone-android-recording-test'),
      apiLevel: 36,
    })
    expect(spawn).toHaveBeenCalledWith('/sdk/adb', 'api-36', expect.any(String), 0)
    await recorder.stop('android:api-36')
  })
})
