import { Directory, File, Paths } from 'expo-file-system'
import { FilePreviewCache, safePairingSegment, type FilePreviewCacheDisk } from './file-preview-cache'

/** Isolated from the share/save temp files in `file-preview/`. */
const CACHE_ROOT = 'file-preview-cache'

function expoDisk(): FilePreviewCacheDisk {
  const fileOf = (pairingId: string, fileName: string) =>
    new File(Paths.cache, CACHE_ROOT, safePairingSegment(pairingId), fileName)
  const dirOf = (pairingId: string) =>
    new Directory(Paths.cache, CACHE_ROOT, safePairingSegment(pairingId))
  return {
    write(pairingId, fileName, bytes) {
      const file = fileOf(pairingId, fileName)
      file.create({ overwrite: true, intermediates: true })
      file.write(bytes)
      return file.uri
    },
    exists(pairingId, fileName) {
      try { return fileOf(pairingId, fileName).exists } catch { return false }
    },
    uri(pairingId, fileName) {
      return fileOf(pairingId, fileName).uri
    },
    remove(pairingId, fileName) {
      try {
        const file = fileOf(pairingId, fileName)
        if (file.exists) file.delete()
      } catch { /* the OS may already have reclaimed it */ }
    },
    wipePairing(pairingId) {
      try {
        const dir = dirOf(pairingId)
        if (dir.exists) dir.delete()
      } catch { /* nothing to drop */ }
    },
  }
}

let defaultCache: FilePreviewCache | null = null

export function getFilePreviewCache(): FilePreviewCache {
  return defaultCache ??= new FilePreviewCache(expoDisk())
}

export function clearFilePreviewCache(pairingId: string): void {
  getFilePreviewCache().clearPairing(pairingId)
}

/** Test hook: drop every pairing this process has touched. */
export function resetFilePreviewCache(): void {
  defaultCache?.reset()
  defaultCache = null
}
