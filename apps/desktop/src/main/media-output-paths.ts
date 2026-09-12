import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Every built-in screenshot producer writes under one temp root, one
 * subdirectory per producer. Temp rather than userData on purpose: nothing
 * prunes captures, so the OS has to; and on macOS/Windows userData sits under
 * `Application Support/SuperOne …`, whose spaces make a bare `![…](path)`
 * invalid CommonMark. Recordings the agent keeps are copied into
 * `userData/recordings` by `adoptActionRecording`, so nothing durable lives here.
 */
export const CAPTURE_ROOT = join(tmpdir(), 'super-one-captures')

export type CaptureProducer = 'browser' | 'computer-use' | 'ios-simulator' | 'android' | 'ios-mirror'

export function captureDir(producer: CaptureProducer): string {
  return join(CAPTURE_ROOT, producer)
}

export const BROWSER_SCREENSHOT_DIR = captureDir('browser')
export const COMPUTER_USE_SCREENSHOT_DIR = captureDir('computer-use')
export const BROWSER_DOWNLOAD_FALLBACK_DIR = join(tmpdir(), 'super-one-browser-downloads')

/** Keep producers and both media transports on the same directory contract. */
export function builtInCaptureRoots(): string[] {
  return [CAPTURE_ROOT, BROWSER_DOWNLOAD_FALLBACK_DIR]
}
