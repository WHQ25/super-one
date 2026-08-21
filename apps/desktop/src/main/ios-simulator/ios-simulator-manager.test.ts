import { describe, expect, it, vi } from 'vitest'
import type {
  IosSimulatorDevice,
  IosSimulatorFrame,
  IosSimulatorInput,
  IosSimulatorPreviewQuality,
  IosSimulatorStatus,
} from '@superone/shared/ios-simulator'
import { isIosSimulatorLandscape } from '@superone/shared/ios-simulator'
import type {
  IosSimulatorNativeAttachment,
  IosSimulatorNativeStreamInfo,
  NativeFramePacket,
} from './helper-client'
import { IosSimulatorManager } from './ios-simulator-manager'

const status: IosSimulatorStatus = {
  supported: true,
  platform: 'darwin',
  developerDirectory: '/Applications/Xcode.app/Contents/Developer',
  xcodeVersion: 'Xcode 26.6',
  xcodeBuild: '17F113',
  simctlPath: '/usr/bin/simctl',
  previewMode: 'native-framebuffer',
  helper: null,
}

function device(overrides: Partial<IosSimulatorDevice> = {}): IosSimulatorDevice {
  return {
    udid: 'device-a',
    name: 'iPhone 17 Pro',
    runtimeIdentifier: 'runtime-ios-26',
    runtimeName: 'iOS 26.0',
    state: 'Shutdown',
    booted: false,
    available: true,
    ownedBySuperOne: false,
    ...overrides,
  }
}

function setup(initial = device()) {
  let current = initial
  let attachment: IosSimulatorNativeAttachment | null = null
  let frameListener: ((frame: NativeFramePacket) => void) | null = null
  const simctl = {
    status: vi.fn(async () => status),
    listDevices: vi.fn(async () => [current]),
    listRuntimes: vi.fn(async () => []),
    listDeviceTypeBundles: vi.fn(async () => new Map<string, string>()),
    create: vi.fn(async () => current.udid),
    boot: vi.fn(async () => { current = device({ ...current, state: 'Booted', booted: true }) }),
    shutdown: vi.fn(async () => { current = device({ ...current, state: 'Shutdown', booted: false }) }),
    writePasteboard: vi.fn(async () => {}),
  }
  let streamInfo: IosSimulatorNativeStreamInfo | null = null
  let alive = true
  let guestLandscape = false
  let guestFollowsRotation = true
  const native = {
    get attachment() { return attachment },
    get streamInfo() { return streamInfo },
    get alive() { return alive },
    attach: vi.fn(async (udid: string) => {
      // A rebuild hands back a fresh process, so attaching revives the fake too.
      alive = true
      attachment = { udid, pixelWidth: 1179, pixelHeight: 2556, inputAvailable: true }
      return attachment
    }),
    startFrames: vi.fn(async (
      _preferredMode: 'native-framebuffer' | 'native-h264',
      quality: IosSimulatorPreviewQuality,
      listener: (frame: NativeFramePacket) => void,
    ) => {
      // Mirrors the helper, which rejects `stream.start` while one is open.
      if (frameListener) throw new Error('Frame stream is already running.')
      frameListener = listener
      // Mirrors the helper's own rounding so a scaled stream reports what it encodes.
      const scale = quality.scale
      streamInfo = {
        codec: 'h264' as const,
        pixelWidth: scale >= 1 ? 1179 : Math.round(1179 * scale) & ~1,
        pixelHeight: scale >= 1 ? 2556 : Math.round(2556 * scale) & ~1,
      }
      return streamInfo
    }),
    closeFrames: vi.fn(async () => { frameListener = null; streamInfo = null }),
    input: vi.fn(async (input: IosSimulatorInput) => {
      // Models an app that follows the device, which is what most of them do. The
      // guest is what the manager now reads back, so the fake has to have one.
      if (input.type === 'rotate' && guestFollowsRotation) {
        guestLandscape = isIosSimulatorLandscape(input.orientation)
      }
      return { ok: true }
    }),
    // Guest POINT space, so the root frame turns with the device -- this is the only
    // reading that says whether the guest acted on the orientation event.
    dumpAccessibility: vi.fn(async () => ({
      generation: 1,
      nodes: 1,
      complete: true,
      tree: {
        uid: 1,
        role: 'application',
        frame: (guestLandscape ? [0, 0, 956, 440] : [0, 0, 440, 956]) as [number, number, number, number],
      },
    })),
    hitTestAccessibility: vi.fn(async () => ({ uid: 1 })),
    performAccessibility: vi.fn(async () => {}),
    dispose: vi.fn(async () => { attachment = null; frameListener = null; streamInfo = null }),
  }
  const nativeFactory = vi.fn(async () => native)
  const stopped: string[] = []
  const capture = {
    screenshot: vi.fn(async () => {}),
    startRecording: vi.fn(async (_udid: string, outputPath: string) => ({
      stop: vi.fn(async () => { stopped.push(outputPath) }),
    })),
  }
  return {
    simctl,
    capture,
    stopped,
    native,
    nativeFactory,
    /** An app that pins itself upright -- the home screen, Spotlight, most modals. */
    lockGuestUpright: () => { guestFollowsRotation = false },
    /** The helper process going away underneath a session that still holds it. */
    crashHelper: () => {
      alive = false
      attachment = null
      frameListener = null
      streamInfo = null
    },
    emitFrame: (frame: NativeFramePacket = {
      kind: 'h264', keyframe: true, timestampUs: 123_000,
      data: Buffer.from([0, 0, 0, 1, 0x65]),
    }) => frameListener?.(frame),
  }
}

describe('IosSimulatorManager', () => {
  it('boots, attaches the native helper, and marks only its own device', async () => {
    const { simctl, native, nativeFactory } = setup()
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })

    const state = await manager.boot('session-a', 'device-a')

    expect(simctl.boot).toHaveBeenCalledWith('device-a')
    expect(native.attach).toHaveBeenCalledWith('device-a')
    expect(state.interactive).toBe(true)
    expect(state.device).toEqual(expect.objectContaining({
      udid: 'device-a', booted: true, ownedBySuperOne: true, boundSessionId: 'session-a',
    }))
  })

  it('announces a device the renderer never asked for', async () => {
    // The agent's device_request_launch boots through this manager, so the panel and
    // the floating preview learn about the binding only from this event -- there is no
    // IPC return value to read when the renderer did not make the call.
    const { simctl, nativeFactory } = setup()
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    const seen: Array<{ sessionId: string; phase: string; udid: string | undefined }> = []
    manager.onSessionState((state) => {
      seen.push({ sessionId: state.sessionId, phase: state.phase, udid: state.device?.udid })
    })

    await manager.boot('session-a', 'device-a')

    expect(seen.at(-1)).toEqual({ sessionId: 'session-a', phase: 'ready', udid: 'device-a' })
  })

  it('announces the device going away again', async () => {
    const { simctl, nativeFactory } = setup(device({ state: 'Booted', booted: true }))
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    await manager.bind('session-a', 'device-a')
    const seen: string[] = []
    manager.onSessionState((state) => { seen.push(state.phase) })

    await manager.detach('session-a')

    expect(seen.at(-1)).toBe('idle')
  })

  it("suppresses Apple's Simulator for as long as it holds a device it booted", async () => {
    // simctl boot is headless, but a Simulator.app that is already running opens a
    // window for anything that boots -- so the preview would always arrive beside an
    // uninvited second copy of the same screen. It also gets relaunched mid-session by
    // `flutter run` and friends, which is why this is a watch and not one hide.
    const { simctl, nativeFactory } = setup()
    const stop = vi.fn()
    const watchExternalSimulator = vi.fn(() => stop)
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, watchExternalSimulator, helperProbe: async () => null, attachAttempts: 1,
    })

    await manager.boot('session-a', 'device-a')
    expect(watchExternalSimulator).toHaveBeenCalledTimes(1)
    expect(stop).not.toHaveBeenCalled()

    // Giving the device back is the end of any claim on the user's window manager.
    await manager.releaseSession('session-a')
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('stops suppressing the external Simulator once the device is shut down', async () => {
    // The other way a booted device goes away. A watcher left running would keep
    // hiding an app the user is now entitled to open for its own sake.
    const { simctl, nativeFactory } = setup()
    const stop = vi.fn()
    const watchExternalSimulator = vi.fn(() => stop)
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, watchExternalSimulator, helperProbe: async () => null, attachAttempts: 1,
    })
    await manager.boot('session-a', 'device-a')

    await manager.shutdown('session-a')

    expect(stop).toHaveBeenCalledTimes(1)
    // Idempotent: a second pass over an empty ledger must not stop it twice.
    await manager.dispose()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('leaves the external Simulator alone when it only attaches to a running device', async () => {
    // The user was plausibly watching that device in Simulator.app on purpose. Taking
    // over the preview is not a reason to pull their window out from under them.
    const { simctl, nativeFactory } = setup(device({ state: 'Booted', booted: true }))
    const watchExternalSimulator = vi.fn(() => vi.fn())
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, watchExternalSimulator, helperProbe: async () => null, attachAttempts: 1,
    })

    await manager.boot('session-a', 'device-a')

    expect(simctl.boot).not.toHaveBeenCalled()
    expect(watchExternalSimulator).not.toHaveBeenCalled()
  })

  it('prevents another session from taking the same device', async () => {
    const { simctl, nativeFactory } = setup(device({ state: 'Booted', booted: true }))
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    await manager.bind('session-a', 'device-a')

    await expect(manager.bind('session-b', 'device-a')).rejects.toThrow(/already bound/i)
  })

  it('releases its helper without shutting down an externally booted device', async () => {
    const { simctl, native, nativeFactory } = setup(device({ state: 'Booted', booted: true }))
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    await manager.bind('session-a', 'device-a')

    await manager.releaseSession('session-a')

    expect(native.dispose).toHaveBeenCalled()
    expect(simctl.shutdown).not.toHaveBeenCalled()
  })

  it('shuts the device down on release when it was the one that booted it', async () => {
    const { simctl, nativeFactory } = setup()
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    await manager.boot('session-a', 'device-a')

    await manager.releaseSession('session-a')

    expect(simctl.shutdown).toHaveBeenCalledWith('device-a')
    // The ledger is cleared, so a later dispose cannot shut the same device twice.
    await manager.dispose()
    expect(simctl.shutdown).toHaveBeenCalledTimes(1)
  })

  it('streams native framebuffer frames in sequence and stops cleanly', async () => {
    const { simctl, native, nativeFactory, emitFrame } = setup(device({ state: 'Booted', booted: true }))
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    await manager.bind('session-a', 'device-a')
    const sequences: number[] = []

    const unsubscribe = manager.subscribe('session-a', (frame) => sequences.push(frame.sequence))
    await vi.waitFor(() => expect(native.startFrames).toHaveBeenCalled())
    emitFrame()
    emitFrame()
    unsubscribe()
    await vi.waitFor(() => expect(native.closeFrames).toHaveBeenCalled())

    expect(sequences).toEqual([1, 2])
    expect(native.startFrames).toHaveBeenCalledWith(
      'native-h264',
      { scale: 1, maxFrameRate: 0 },
      expect.any(Function),
    )
  })

  it('maps native H.264 configuration and sample packets for WebCodecs', async () => {
    const { simctl, native, nativeFactory, emitFrame } = setup(device({ state: 'Booted', booted: true }))
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    await manager.bind('session-a', 'device-a')
    const frames: Parameters<Parameters<typeof manager.subscribe>[1]>[0][] = []
    const unsubscribe = manager.subscribe('session-a', (frame) => frames.push(frame))
    await vi.waitFor(() => expect(native.startFrames).toHaveBeenCalled())

    emitFrame({
      kind: 'h264-config', keyframe: false, timestampUs: 100_000,
      data: Buffer.from('avc1.4D0032'),
    })
    emitFrame({
      kind: 'h264', keyframe: true, timestampUs: 101_000,
      data: Buffer.from([0, 0, 0, 1, 0x65]),
    })
    unsubscribe()

    expect(frames[0]).toEqual(expect.objectContaining({
      mimeType: 'video/avc', codecConfig: true, codec: 'avc1.4D0032',
      codedWidth: 1179, codedHeight: 2556,
    }))
    expect(frames[1]).toEqual(expect.objectContaining({
      mimeType: 'video/avc', keyframe: true, timestampUs: 101_000,
    }))
  })

  it('reports PNG mode when the native encoder falls back', async () => {
    const { simctl, native, nativeFactory } = setup(device({ state: 'Booted', booted: true }))
    native.startFrames.mockResolvedValue({
      codec: 'png', pixelWidth: 1179, pixelHeight: 2556,
      fallbackReason: 'VideoToolbox unavailable',
    })
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    await manager.bind('session-a', 'device-a')
    const unsubscribe = manager.subscribe('session-a', () => undefined)
    await vi.waitFor(() => expect(native.startFrames).toHaveBeenCalled())

    expect((await manager.getSessionState('session-a')).previewMode).toBe('native-framebuffer')
    unsubscribe()
  })

  it('forwards atomic multi-touch input to the native helper', async () => {
    const { simctl, native, nativeFactory } = setup(device({ state: 'Booted', booted: true }))
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    await manager.bind('session-a', 'device-a')

    const input = {
      type: 'touch.update' as const,
      contacts: [
        { id: 1, phase: 'moved' as const, xRatio: 0.25, yRatio: 0.5 },
        { id: 2, phase: 'moved' as const, xRatio: 0.75, yRatio: 0.5 },
      ],
    }
    await manager.input('session-a', input)

    expect(native.input).toHaveBeenCalledWith(input)
  })

  it('disposes a helper whose attach completes after the session is released', async () => {
    const { simctl, native, nativeFactory } = setup(device({ state: 'Booted', booted: true }))
    let finishAttach: (() => void) | undefined
    native.attach.mockImplementation(async (udid: string) => {
      await new Promise<void>((resolve) => { finishAttach = resolve })
      return { udid, pixelWidth: 1179, pixelHeight: 2556, inputAvailable: true }
    })
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })

    const binding = manager.bind('session-a', 'device-a')
    await vi.waitFor(() => expect(native.attach).toHaveBeenCalled())
    const release = manager.releaseSession('session-a')
    finishAttach?.()
    await Promise.all([binding, release])

    expect(native.dispose).toHaveBeenCalledOnce()
    expect(await manager.getSessionState('session-a')).toEqual(expect.objectContaining({
      device: null,
      phase: 'idle',
    }))
  })

  it('closes a frame stream that finishes starting after unsubscribe', async () => {
    const { simctl, native, nativeFactory } = setup(device({ state: 'Booted', booted: true }))
    let finishStart: (() => void) | undefined
    native.startFrames.mockImplementation(async (): Promise<IosSimulatorNativeStreamInfo> => {
      await new Promise<void>((resolve) => { finishStart = resolve })
      return { codec: 'h264', pixelWidth: 1179, pixelHeight: 2556 }
    })
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    await manager.bind('session-a', 'device-a')

    const unsubscribe = manager.subscribe('session-a', () => undefined)
    await vi.waitFor(() => expect(native.startFrames).toHaveBeenCalled())
    unsubscribe()
    finishStart?.()
    await vi.waitFor(() => expect(native.closeFrames).toHaveBeenCalled())

    expect(native.closeFrames).toHaveBeenCalled()
  })

  it('keeps a simulator running when the session detaches from it', async () => {
    const { simctl, nativeFactory, native } = setup(device({ state: 'Booted', booted: true }))
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    await manager.boot('session-a', 'device-a')

    const state = await manager.detach('session-a')

    expect(state.device).toBeNull()
    expect(native.dispose).toHaveBeenCalledOnce()
    expect(simctl.shutdown).not.toHaveBeenCalled()
    const [listed] = await manager.listDevices()
    expect(listed).toEqual(expect.objectContaining({ booted: true, ownedBySuperOne: false }))
    expect(listed.boundSessionId).toBeUndefined()
  })

  it('leaves a detached simulator alone when the panel is later closed', async () => {
    const { simctl, nativeFactory } = setup()
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    // Booting marks it ours, which is exactly what detach has to give up.
    await manager.boot('session-a', 'device-a')
    await manager.detach('session-a')

    await manager.releaseSession('session-a')
    await manager.dispose()

    expect(simctl.shutdown).not.toHaveBeenCalled()
  })

  it('shuts the device down and unbinds the session on terminate', async () => {
    const { simctl, nativeFactory, native } = setup(device({ state: 'Booted', booted: true }))
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    await manager.bind('session-a', 'device-a')

    const state = await manager.shutdown('session-a')

    expect(simctl.shutdown).toHaveBeenCalledWith('device-a')
    expect(native.dispose).toHaveBeenCalledOnce()
    expect(state.device).toBeNull()
    // Unbound, so the next session may take it.
    await expect(manager.bind('session-b', 'device-a')).resolves.toBeDefined()
  })

  it('rebinds a running simulator that no session owns', async () => {
    const { simctl, nativeFactory } = setup()
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    await manager.boot('session-a', 'device-a')
    await manager.detach('session-a')

    const state = await manager.boot('session-b', 'device-a')

    // Already running, so attaching must not re-boot it.
    expect(simctl.boot).toHaveBeenCalledOnce()
    expect(state).toEqual(expect.objectContaining({ phase: 'ready', interactive: true }))
  })

  it('restarts the preview when a remount closes and reopens it in the same tick', async () => {
    const { simctl, nativeFactory, native, emitFrame } = setup(device({ state: 'Booted', booted: true }))
    const streamErrors: unknown[] = []
    const manager = new IosSimulatorManager({
      simctl,
      nativeFactory,
      helperProbe: async () => null,
      attachAttempts: 1,
      onStreamError: (_sessionId, error) => streamErrors.push(error),
    })
    await manager.bind('session-a', 'device-a')

    // StrictMode runs the effect, its cleanup, then the effect again.
    const unsubscribe = manager.subscribe('session-a', () => undefined)
    unsubscribe()
    const frames: number[] = []
    manager.subscribe('session-a', (frame) => frames.push(frame.sequence))

    await vi.waitFor(() => expect(native.startFrames).toHaveBeenCalled())
    emitFrame()

    // The stream the remount inherited stays open, so no second start is attempted
    // and the stale close does not take it down under the new listener.
    expect(native.startFrames).toHaveBeenCalledOnce()
    expect(native.closeFrames).not.toHaveBeenCalled()
    expect(streamErrors).toEqual([])
    expect(frames).toEqual([1])
  })
})

describe('IosSimulatorManager preview quality', () => {
  it('opens the stream with the quality the subscriber asked for', async () => {
    const { simctl, native, nativeFactory } = setup(device({ state: 'Booted', booted: true }))
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    await manager.bind('session-a', 'device-a')

    const quality = { scale: 0.5, maxFrameRate: 30 }
    const unsubscribe = manager.subscribe('session-a', () => {}, 'native-h264', quality)
    await vi.waitFor(() => expect(native.startFrames).toHaveBeenCalled())

    expect(native.startFrames).toHaveBeenCalledWith('native-h264', quality, expect.any(Function))
    unsubscribe()
  })

  it('configures the decoder with the negotiated size, not the device framebuffer', async () => {
    const { simctl, native, nativeFactory, emitFrame } = setup(device({ state: 'Booted', booted: true }))
    const manager = new IosSimulatorManager({
      simctl, nativeFactory, helperProbe: async () => null, attachAttempts: 1,
    })
    await manager.bind('session-a', 'device-a')

    const frames: IosSimulatorFrame[] = []
    const unsubscribe = manager.subscribe(
      'session-a', (frame) => frames.push(frame), 'native-h264', { scale: 0.5, maxFrameRate: 0 })
    await vi.waitFor(() => expect(native.startFrames).toHaveBeenCalled())
    emitFrame({
      kind: 'h264-config', keyframe: true, timestampUs: 0, data: Buffer.from('avc1.4D0028'),
    })

    // The regression this guards: reading the attachment size here would tell
    // WebCodecs the frames are 1179x2556 when the helper is sending 590x1278, and
    // every frame decodes to garbage.
    const config = frames.find((frame) => frame.codecConfig)
    expect(config).toMatchObject({ codedWidth: 590, codedHeight: 1278 })
    unsubscribe()
  })
})

describe('IosSimulatorManager screen capture', () => {
  function bootedManager(extra: ReturnType<typeof setup>) {
    return new IosSimulatorManager({
      simctl: extra.simctl,
      nativeFactory: extra.nativeFactory,
      capture: extra.capture,
      captureRoot: '/captures',
      helperProbe: async () => null,
      attachAttempts: 1,
    })
  }

  it('writes a screenshot into this session\'s own capture directory', async () => {
    const harness = setup()
    const manager = bootedManager(harness)
    await manager.boot('session-1', 'device-a')

    const capture = await manager.screenshot('session-1')

    expect(capture.kind).toBe('screenshot')
    expect(capture.path).toBe(`/captures/session-1/${capture.fileName}`)
    expect(capture.fileName).toMatch(/^iPhone-17-Pro-\d{8}-\d{6}\.png$/)
    expect(harness.capture.screenshot).toHaveBeenCalledWith('device-a', capture.path)
  })

  it('refuses to capture a device that is not running', async () => {
    const harness = setup()
    const manager = bootedManager(harness)
    await manager.bind('session-1', 'device-a')

    await expect(manager.screenshot('session-1')).rejects.toThrow('The simulator is not running.')
  })

  it('returns the finished movie when a recording is stopped', async () => {
    const harness = setup()
    const manager = bootedManager(harness)
    await manager.boot('session-1', 'device-a')

    const started = await manager.startRecording('session-1')
    expect(manager.isRecording('session-1')).toBe(true)
    const stopped = await manager.stopRecording('session-1')

    expect(stopped).toEqual(started)
    expect(stopped!.fileName).toMatch(/\.mp4$/)
    expect(harness.stopped).toEqual([started.path])
    expect(manager.isRecording('session-1')).toBe(false)
  })

  it('reports nothing when a session that was never recording is stopped', async () => {
    const harness = setup()
    const manager = bootedManager(harness)
    await manager.boot('session-1', 'device-a')

    await expect(manager.stopRecording('session-1')).resolves.toBeNull()
  })

  it('finalises an open recording before shutting the device down', async () => {
    const harness = setup()
    const manager = bootedManager(harness)
    await manager.boot('session-1', 'device-a')
    const started = await manager.startRecording('session-1')

    await manager.shutdown('session-1')

    // simctl can only close the movie while the device it reads from is still up,
    // so the stop has to land ahead of the shutdown.
    expect(harness.stopped).toEqual([started.path])
    expect(manager.isRecording('session-1')).toBe(false)
  })

  it('finalises an open recording when the session detaches', async () => {
    const harness = setup()
    const manager = bootedManager(harness)
    await manager.boot('session-1', 'device-a')
    const started = await manager.startRecording('session-1')

    await manager.detach('session-1')

    expect(harness.stopped).toEqual([started.path])
  })

  it('drops the recording when simctl never manages to start it', async () => {
    const harness = setup()
    harness.capture.startRecording.mockRejectedValueOnce(new Error('Recording failed.'))
    const manager = bootedManager(harness)
    await manager.boot('session-1', 'device-a')

    await expect(manager.startRecording('session-1')).rejects.toThrow('Recording failed.')
    // A failed start that stayed registered would wedge the button on "recording".
    expect(manager.isRecording('session-1')).toBe(false)
  })
})

describe('IosSimulatorManager text input', () => {
  async function readyManager() {
    const harness = setup()
    const manager = new IosSimulatorManager({
      simctl: harness.simctl,
      nativeFactory: harness.nativeFactory,
      helperProbe: async () => null,
      attachAttempts: 1,
    })
    await manager.boot('session-a', 'device-a')
    harness.native.input.mockClear()
    return { ...harness, manager }
  }

  it('sends a single keystroke as a keystroke', async () => {
    const { manager, native, simctl } = await readyManager()

    await manager.input('session-a', { type: 'text', text: 'a' })

    expect(native.input).toHaveBeenCalledWith({ type: 'text', text: 'a' })
    expect(simctl.writePasteboard).not.toHaveBeenCalled()
  })

  it('routes text the simulated keyboard cannot spell through the device pasteboard', async () => {
    const { manager, native, simctl } = await readyManager()

    // The regression this guards: Indigo's keyboard channel only carries HID usage
    // codes, so every one of these characters used to be counted as skipped and
    // silently dropped.
    await manager.input('session-a', { type: 'text', text: '你好' })

    expect(simctl.writePasteboard).toHaveBeenCalledWith('device-a', '你好')
    expect(native.input).toHaveBeenCalledWith({ type: 'paste' })
    expect(native.input).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'text' }))
  })

  it('pastes a long ASCII block rather than holding the input queue for it', async () => {
    const { manager, native, simctl } = await readyManager()

    await manager.input('session-a', { type: 'text', text: 'the quick brown fox' })

    expect(simctl.writePasteboard).toHaveBeenCalledWith('device-a', 'the quick brown fox')
    expect(native.input).toHaveBeenCalledWith({ type: 'paste' })
  })
})

function rotationManager(harness: ReturnType<typeof setup>) {
  return new IosSimulatorManager({
    simctl: harness.simctl,
    nativeFactory: harness.nativeFactory,
    helperProbe: async () => null,
    attachAttempts: 1,
    // Real guests take a few hundred milliseconds to turn; the fake turns at once.
    rotationConfirmMs: 50,
    rotationPollMs: 5,
  })
}

describe('IosSimulatorManager rotation', () => {
  it('reports the orientation the guest accepted, and forgets it on shutdown', async () => {
    const harness = setup()
    const manager = rotationManager(harness)
    await manager.boot('session-a', 'device-a')

    await manager.input('session-a', { type: 'rotate', orientation: 'landscape-left' })
    expect((await manager.getSessionState('session-a')).orientation).toBe('landscape-left')

    await manager.shutdown('session-a')
    await manager.boot('session-a', 'device-a')
    expect((await manager.getSessionState('session-a')).orientation).toBe('portrait')
  })

  it('leaves the panel upright when the guest refuses the rotation', async () => {
    const harness = setup()
    harness.native.input.mockResolvedValue({ ok: false, error: 'Rotation was rejected.' })
    const manager = new IosSimulatorManager({
      simctl: harness.simctl,
      nativeFactory: harness.nativeFactory,
      helperProbe: async () => null,
      attachAttempts: 1,
    })
    await manager.boot('session-a', 'device-a')

    await manager.input('session-a', { type: 'rotate', orientation: 'landscape-left' })

    expect((await manager.getSessionState('session-a')).orientation).toBe('portrait')
  })
})

describe('IosSimulatorManager stream lifetime', () => {
  function bootedManager(harness: ReturnType<typeof setup>) {
    return new IosSimulatorManager({
      simctl: harness.simctl,
      capture: harness.capture,
      captureRoot: '/tmp/superone-ios-captures',
      nativeFactory: harness.nativeFactory,
      helperProbe: async () => null,
      attachAttempts: 1,
    })
  }

  it('tears the preview and the recording down before rebinding to another device', async () => {
    const harness = setup(device({ state: 'Booted', booted: true }))
    harness.simctl.listDevices.mockImplementation(async () => [
      device({ state: 'Booted', booted: true }),
      device({ udid: 'device-b', name: 'iPad Pro 13', state: 'Booted', booted: true }),
    ])
    const manager = bootedManager(harness)
    await manager.bind('session-a', 'device-a')
    manager.subscribe('session-a', () => undefined)
    await vi.waitFor(() => expect(harness.native.startFrames).toHaveBeenCalledTimes(1))
    await manager.startRecording('session-a')

    await manager.bind('session-a', 'device-b')

    // simctl can only finalise the movie while the device it reads from is up, so
    // the stop has to happen on this side of the rebind.
    expect(harness.stopped).toHaveLength(1)
    expect(manager.isRecording('session-a')).toBe(false)
    // And the stream is gone rather than left marked `started`: it used to block
    // every reopen, so the new device's preview stayed black for the whole binding.
    expect(harness.native.closeFrames).toHaveBeenCalled()
    manager.subscribe('session-a', () => undefined)
    await vi.waitFor(() => expect(harness.native.startFrames).toHaveBeenCalledTimes(2))
  })

  it('rebuilds a session whose helper process died underneath it', async () => {
    const harness = setup(device({ state: 'Booted', booted: true }))
    const manager = bootedManager(harness)
    await manager.bind('session-a', 'device-a')
    manager.subscribe('session-a', () => undefined)
    await vi.waitFor(() => expect(harness.native.startFrames).toHaveBeenCalledTimes(1))

    harness.crashHelper()

    // The dead runtime used to be handed straight back, so every input answered
    // "HID input is unavailable" until the user found the Refresh button.
    expect(await manager.input('session-a', { type: 'button', button: 'home' }))
      .toEqual({ ok: true })
    expect(harness.nativeFactory).toHaveBeenCalledTimes(2)
    // The preview comes back with it instead of staying frozen on the last frame.
    await vi.waitFor(() => expect(harness.native.startFrames).toHaveBeenCalledTimes(2))
  })

  it('replays the H.264 configuration to a listener that joins a running stream', async () => {
    const harness = setup(device({ state: 'Booted', booted: true }))
    const manager = bootedManager(harness)
    await manager.bind('session-a', 'device-a')
    manager.subscribe('session-a', () => undefined)
    await vi.waitFor(() => expect(harness.native.startFrames).toHaveBeenCalled())
    harness.emitFrame({
      kind: 'h264-config', keyframe: false, timestampUs: 100_000,
      data: Buffer.from('avc1.4D0032'),
    })

    const late: IosSimulatorFrame[] = []
    manager.subscribe('session-a', (frame) => late.push(frame))

    // Both the helper and the encoder send this exactly once per stream, so a second
    // window's decoder was never configured — it simply stayed black forever.
    expect(late[0]).toEqual(expect.objectContaining({
      codecConfig: true, codec: 'avc1.4D0032', codedWidth: 1179, codedHeight: 2556,
    }))
  })
})

describe('IosSimulatorManager rotation (refusals)', () => {
  it('leaves the panel upright when the guest refuses the rotation', async () => {
    const harness = setup()
    harness.native.input.mockResolvedValue({ ok: false, error: 'Rotation was rejected.' })
    const manager = rotationManager(harness)
    await manager.boot('session-a', 'device-a')

    await manager.input('session-a', { type: 'rotate', orientation: 'landscape-left' })

    expect((await manager.getSessionState('session-a')).orientation).toBe('portrait')
  })

  it('fails the rotation when the event lands but the foreground app stays upright', async () => {
    const harness = setup()
    harness.lockGuestUpright()
    const manager = rotationManager(harness)
    await manager.boot('session-a', 'device-a')

    const result = await manager.input('session-a', { type: 'rotate', orientation: 'landscape-left' })

    // Delivering the event is not performing the rotation: reporting the send made
    // `device_act` claim a turn that never happened.
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/kept its own orientation/i)
    expect((await manager.getSessionState('session-a')).orientation).toBe('portrait')
  })

  it('takes a half turn on trust, because the screen keeps its shape through one', async () => {
    const harness = setup()
    harness.lockGuestUpright()
    const manager = rotationManager(harness)
    await manager.boot('session-a', 'device-a')

    const result = await manager.input('session-a', {
      type: 'rotate', orientation: 'portrait-upside-down',
    })

    expect(result.ok).toBe(true)
    expect((await manager.getSessionState('session-a')).orientation).toBe('portrait-upside-down')
  })

  it('still rotates when the helper cannot see the guest at all', async () => {
    const harness = setup()
    harness.lockGuestUpright()
    harness.native.dumpAccessibility.mockRejectedValue(new Error('Accessibility is unavailable.'))
    const manager = rotationManager(harness)
    await manager.boot('session-a', 'device-a')

    const result = await manager.input('session-a', { type: 'rotate', orientation: 'landscape-left' })

    // Verification is a bonus. A helper build without accessibility would otherwise
    // lose a control that works perfectly well.
    expect(result.ok).toBe(true)
    expect((await manager.getSessionState('session-a')).orientation).toBe('landscape-left')
  })
})

describe('IosSimulatorManager session state pushes', () => {
  it('announces a rotation the panel did not ask for', async () => {
    const harness = setup()
    const manager = rotationManager(harness)
    await manager.boot('session-a', 'device-a')
    const seen: string[] = []
    manager.onSessionState((state) => { seen.push(state.orientation) })

    // What `device_act` does: the renderer never sees this call, so without a push
    // the panel keeps drawing the device upright around a guest that has turned.
    await manager.input('session-a', { type: 'rotate', orientation: 'landscape-left' })

    expect(seen).toEqual(['landscape-left'])
  })

  it('announces a refused rotation too, so an optimistic panel can turn back', async () => {
    const harness = setup()
    harness.lockGuestUpright()
    const manager = rotationManager(harness)
    await manager.boot('session-a', 'device-a')
    const seen: string[] = []
    manager.onSessionState((state) => { seen.push(state.orientation) })

    await manager.input('session-a', { type: 'rotate', orientation: 'landscape-left' })

    expect(seen).toEqual(['portrait'])
  })

  it('stops announcing once the listener unsubscribes', async () => {
    const harness = setup()
    const manager = rotationManager(harness)
    await manager.boot('session-a', 'device-a')
    const seen: string[] = []
    const stop = manager.onSessionState((state) => { seen.push(state.orientation) })

    await manager.input('session-a', { type: 'rotate', orientation: 'landscape-left' })
    stop()
    await manager.input('session-a', { type: 'rotate', orientation: 'portrait' })

    expect(seen).toEqual(['landscape-left'])
  })
})
