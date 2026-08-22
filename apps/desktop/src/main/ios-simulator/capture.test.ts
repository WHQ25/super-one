import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { SimctlCapture } from './capture'

class FakeChild extends EventEmitter {
  readonly stderr = new EventEmitter()
  readonly kill = vi.fn((signal: NodeJS.Signals) => {
    // simctl only finalises the movie on SIGINT; mirror that so a test asserting
    // on `stop()` is really asserting on the documented stop path.
    if (signal === 'SIGINT') queueMicrotask(() => this.emit('close', 0))
    return true
  })

  say(line: string): void {
    this.stderr.emit('data', Buffer.from(line))
  }
}

function setup() {
  const children: FakeChild[] = []
  const spawnProcess = vi.fn(() => {
    const child = new FakeChild()
    children.push(child)
    return child
  })
  const ensureDir = vi.fn(async () => {})
  const capture = new SimctlCapture({
    spawnProcess: spawnProcess as never,
    ensureDir,
  })
  return { capture, children, spawnProcess, ensureDir }
}


describe('iOS Simulator screen capture', () => {
  it('creates the target directory before asking simctl to write into it', async () => {
    const { capture, children, ensureDir } = setup()

    const flight = capture.screenshot('udid-a', '/captures/session-1/shot.png')
    await vi.waitFor(() => expect(children).toHaveLength(1))
    children[0]!.emit('close', 0)
    await flight

    expect(ensureDir).toHaveBeenCalledWith('/captures/session-1')
  })

  it('reports simctl stderr when a screenshot fails', async () => {
    const { capture, children } = setup()

    const flight = capture.screenshot('udid-a', '/captures/session-1/shot.png')
    await vi.waitFor(() => expect(children).toHaveLength(1))
    children[0]!.say('Invalid device: udid-a')
    children[0]!.emit('close', 1)

    await expect(flight).rejects.toThrow('Invalid device: udid-a')
  })

  it('resolves a recording only once simctl says frames are flowing', async () => {
    const { capture, children } = setup()

    const flight = capture.startRecording('udid-a', '/captures/session-1/clip.mp4')
    await vi.waitFor(() => expect(children).toHaveLength(1))
    const settled = vi.fn()
    void flight.then(settled)

    // Spawned is not started: resolving here would light up a "recording" button
    // for a stream that may still fail.
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    children[0]!.say('Recording started\n')
    await expect(flight).resolves.toBeDefined()
  })

  it('stops with SIGINT and waits for simctl to finalise the movie', async () => {
    const { capture, children } = setup()

    const flight = capture.startRecording('udid-a', '/captures/session-1/clip.mp4')
    await vi.waitFor(() => expect(children).toHaveLength(1))
    children[0]!.say('Recording started\n')
    const recording = await flight

    await recording.stop()

    // Anything harsher than SIGINT leaves an unfinalised, unplayable file.
    expect(children[0]!.kill).toHaveBeenCalledWith('SIGINT')
  })

  it('rejects a recording that exits before it ever starts', async () => {
    const { capture, children } = setup()

    const flight = capture.startRecording('udid-a', '/captures/session-1/clip.mp4')
    await vi.waitFor(() => expect(children).toHaveLength(1))
    children[0]!.say('Unable to boot device in current state: Shutdown')
    children[0]!.emit('close', 1)

    await expect(flight).rejects.toThrow('Unable to boot device in current state: Shutdown')
  })
})
