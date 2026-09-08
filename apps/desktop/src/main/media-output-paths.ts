import { join } from 'node:path'
import { tmpdir } from 'node:os'

export const BROWSER_SCREENSHOT_DIR = join(tmpdir(), 'super-one-browser-screenshots')
export const COMPUTER_USE_SCREENSHOT_DIR = join(tmpdir(), 'super-one-computer-use-screenshots')
export const BROWSER_DOWNLOAD_FALLBACK_DIR = join(tmpdir(), 'super-one-browser-downloads')
export const IOS_CAPTURE_FALLBACK_DIR = join(tmpdir(), 'super-one-ios-simulator-captures')

export function deviceCaptureDir(userData: string, platform: 'ios-simulator' | 'android' | 'ios-mirror'): string {
  return join(userData, platform, 'captures')
}

/** Keep producers and both media transports on the same directory contract. */
export function builtInCaptureRoots(userData: string): string[] {
  return [
    BROWSER_SCREENSHOT_DIR,
    COMPUTER_USE_SCREENSHOT_DIR,
    BROWSER_DOWNLOAD_FALLBACK_DIR,
    IOS_CAPTURE_FALLBACK_DIR,
    ...(['ios-simulator', 'android', 'ios-mirror'] as const).map((platform) => deviceCaptureDir(userData, platform)),
  ]
}
