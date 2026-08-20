import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

/** A recording in flight. Stopping is the only thing that produces the file. */
export interface IosSimulatorRecording {
  /** Resolves once simctl has flushed its in-flight frames and closed the movie. */
  stop(): Promise<void>
}

export interface IosSimulatorCapturePort {
  screenshot(udid: string, outputPath: string): Promise<void>
  startRecording(udid: string, outputPath: string): Promise<IosSimulatorRecording>
}

const XCRUN = '/usr/bin/xcrun'

/** simctl only announces this once the first video frame is through the encoder. */
const RECORDING_STARTED = 'Recording started'

/**
 * How long to wait for that announcement. A wedged CoreSimulator can otherwise
 * leave the button spinning forever with an orphan xcrun behind it.
 */
const RECORDING_START_TIMEOUT_MS = 15_000

/**
 * `iPhone-17-Pro-20260820-164452.png` — sortable by name, and free of the spaces
 * and punctuation that make a path awkward to paste into a shell.
 */
export function captureFileName(deviceName: string, extension: string, at: Date): string {
  const slug = deviceName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'simulator'
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
    + `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  return `${slug}-${stamp}.${extension}`
}

export interface SimctlCaptureDeps {
  spawnProcess: typeof spawn
  ensureDir: (path: string) => Promise<void>
}

function defaultDeps(): SimctlCaptureDeps {
  return {
    spawnProcess: spawn,
    ensureDir: async (path) => { await mkdir(path, { recursive: true }) },
  }
}

/**
 * Screen capture through `simctl io`, which reads the device's own display rather
 * than the preview canvas: full native resolution, no chrome, and a real QuickTime
 * movie instead of whatever the browser's MediaRecorder happens to support.
 */
export class SimctlCapture implements IosSimulatorCapturePort {
  private readonly deps: SimctlCaptureDeps

  constructor(deps?: Partial<SimctlCaptureDeps>) {
    this.deps = { ...defaultDeps(), ...deps }
  }

  async screenshot(udid: string, outputPath: string): Promise<void> {
    await this.deps.ensureDir(dirname(outputPath))
    await this.run(['simctl', 'io', udid, 'screenshot', outputPath])
  }

  async startRecording(udid: string, outputPath: string): Promise<IosSimulatorRecording> {
    await this.deps.ensureDir(dirname(outputPath))
    // h264 over Apple's hevc default: the file is meant to be shared, and h264 in
    // an .mp4 plays everywhere without a transcode.
    const args = ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', outputPath]
    return new Promise((resolve, reject) => {
      const child = this.deps.spawnProcess(XCRUN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      let settled = false
      const exited = new Promise<void>((done) => { child.once('close', () => done()) })
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill('SIGKILL')
        reject(new Error('The simulator never started recording.'))
      }, RECORDING_START_TIMEOUT_MS)
      const settle = (run: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        run()
      }

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
        if (!stderr.includes(RECORDING_STARTED)) return
        settle(() => resolve({
          stop: async () => {
            // SIGINT is the documented stop signal. Anything harsher leaves the
            // movie unfinalised, which means a file that will not play.
            child.kill('SIGINT')
            await exited
          },
        }))
      })
      child.once('error', (error) => { settle(() => reject(error)) })
      child.once('close', (code) => {
        settle(() => reject(new Error(stderr.trim() || `simctl recordVideo exited with code ${code}.`)))
      })
    })
  }

  private run(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.deps.spawnProcess(XCRUN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      child.once('error', reject)
      child.once('close', (code) => {
        if (code === 0) { resolve(); return }
        reject(new Error(stderr.trim() || `xcrun ${args.join(' ')} exited with code ${code}.`))
      })
    })
  }
}
