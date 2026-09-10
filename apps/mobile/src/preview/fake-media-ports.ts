import type { SaveOutcome } from '../file-preview-state'
import type { MediaPorts } from '../media-ports'

/** What a fake save should report; `'throw'` simulates a native failure. */
export type FakeSaveBehaviour = SaveOutcome['kind'] | 'throw'

/**
 * Media ports that never touch the photo library, the file system or the
 * share sheet. The gallery and the stories use them to show every outcome the
 * chrome can report; tests use them to assert which action ran.
 */
export function createFakeMediaPorts(options: {
  save?: FakeSaveBehaviour
  share?: 'ok' | 'throw'
  delayMs?: number
  onCall?: (action: 'save' | 'share' | 'openSettings') => void
} = {}): MediaPorts {
  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, options.delayMs ?? 0))
  return {
    async save(_source, toPhotos) {
      options.onCall?.('save')
      await wait()
      const behaviour = options.save ?? 'saved'
      if (behaviour === 'throw') throw new Error('Could not write the file')
      if (behaviour === 'saved') return { kind: 'saved', toPhotos }
      return { kind: behaviour }
    },
    async share() {
      options.onCall?.('share')
      await wait()
      if (options.share === 'throw') throw new Error('Sharing is unavailable on this device')
    },
    openSettings() {
      options.onCall?.('openSettings')
    },
  }
}
