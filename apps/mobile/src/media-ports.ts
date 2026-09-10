import { Directory, File, Paths } from 'expo-file-system'
import * as MediaLibrary from 'expo-media-library'
import * as Sharing from 'expo-sharing'
import { Linking } from 'react-native'
import { FILE_PREVIEW_TEXT, type LocalSource, type SaveOutcome } from './file-preview-state'

/**
 * What the preview's menu can do with bytes the phone holds. Injected rather
 * than imported so the component can be exercised under jest and Storybook
 * without the native modules behind it.
 */
export interface MediaPorts {
  /** Hand the file to the system share sheet. */
  share(source: LocalSource): Promise<void>
  /**
   * Keep a copy on the phone: the photo library for pictures, a folder the
   * user picks for anything else. Resolves rather than throws for the two
   * outcomes the user caused — cancelling the picker, denying the permission.
   */
  save(source: LocalSource, toPhotos: boolean): Promise<SaveOutcome>
  /** Where a denied photo permission is turned back on. */
  openSettings(): void
}

/** Where copies of inline bytes are written; the cache is the OS's to reclaim. */
const CACHE_DIRECTORY = 'file-preview'

/**
 * Both actions need a real file. A downloaded transfer already is one; inline
 * text and a data URI are written out first, under the name the copy should
 * carry so the share sheet and the folder picker both see it.
 */
function ensureFile(source: LocalSource): File {
  if (source.kind === 'file') return new File(source.uri)
  const file = new File(Paths.cache, CACHE_DIRECTORY, source.name)
  file.create({ overwrite: true, intermediates: true })
  if (source.kind === 'text') file.write(source.text)
  else file.write(source.dataUri.slice(source.dataUri.indexOf(',') + 1).replace(/\s+/g, ''), { encoding: 'base64' })
  return file
}

/** The folder picker reports a dismissed sheet as an error; that is not a failure. */
function isCancellation(error: unknown): boolean {
  return error instanceof Error && /cancel/i.test(error.message)
}

export function createMediaPorts(): MediaPorts {
  return {
    async share(source) {
      if (!await Sharing.isAvailableAsync()) throw new Error(FILE_PREVIEW_TEXT.sharingUnavailable)
      const file = ensureFile(source)
      await Sharing.shareAsync(file.uri, { mimeType: source.mimeType, dialogTitle: source.name })
    },

    async save(source, toPhotos) {
      const file = ensureFile(source)
      if (toPhotos) {
        // Write-only access: the phone never reads the library, so it never asks to.
        const permission = await MediaLibrary.requestPermissionsAsync(true)
        if (!permission.granted) return { kind: 'denied' }
        await MediaLibrary.saveToLibraryAsync(file.uri)
        return { kind: 'saved', toPhotos: true }
      }
      const folder = await Directory.pickDirectoryAsync().catch((error: unknown) => {
        if (isCancellation(error)) return null
        throw error
      })
      if (!folder) return { kind: 'cancelled' }
      // Copy through bytes rather than `File.copy`: the picked folder is a
      // content:// tree on Android, which the path-based copy cannot target.
      const target = folder.createFile(source.name, source.mimeType)
      target.write(await file.bytes())
      return { kind: 'saved', toPhotos: false }
    },

    openSettings() {
      void Linking.openSettings()
    },
  }
}
