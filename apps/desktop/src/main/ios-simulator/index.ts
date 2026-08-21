import { join } from 'node:path'
import log from '../logger'
import { IosSimulatorChromeLoader } from './device-chrome'
import { IosSimulatorManager } from './ios-simulator-manager'
import { createIosSimulatorHelperRuntime, probeIosSimulatorHelper } from './helper-client'
import { watchExternalSimulator } from './external-simulator'

let manager: IosSimulatorManager | null = null

export function getIosSimulatorManager(userDataPath: string): IosSimulatorManager {
  const cacheRoot = join(userDataPath, 'ios-simulator', 'helpers')
  const chrome = new IosSimulatorChromeLoader(join(userDataPath, 'ios-simulator', 'chrome'))
  // Artwork is optional, so a failure degrades silently in the UI — log it or the
  // next regression is invisible again.
  chrome.onError = (deviceTypeIdentifier, error) =>
    log.warn('[ios-simulator] device chrome unavailable', deviceTypeIdentifier, error)
  manager ??= new IosSimulatorManager({
    chrome,
    captureRoot: join(userDataPath, 'ios-simulator', 'captures'),
    helperProbe: () => probeIosSimulatorHelper(cacheRoot),
    nativeFactory: () => createIosSimulatorHelperRuntime(cacheRoot),
    watchExternalSimulator: () => watchExternalSimulator(cacheRoot),
    // Without this the panel just sits on its loading spinner forever: a stream that
    // never starts looks exactly like a stream that has not produced a frame yet.
    onStreamError: (sessionId, error) =>
      log.warn('[ios-simulator] preview stream failed to start', sessionId, error),
  })
  return manager
}

export async function disposeIosSimulatorManager(): Promise<void> {
  const current = manager
  manager = null
  await current?.dispose()
}

