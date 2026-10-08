import { Directory, File, Paths } from 'expo-file-system'
import type { McpAppLocalDownload } from '@superone/shared/mcp-app-download'
import { safeCacheFileName } from './file-preview-state'
import { randomId } from './ids'

/** Where a View's downloads wait for the preview's Save or Share; the cache is the OS's to reclaim. */
const CACHE_DIRECTORY = 'mcp-app-downloads'

export interface CachedDownload { name: string; mimeType: string; localUri: string; size: number }

/** Put one `ui/download-file` item on the phone as a file the preview can show, save and share. */
export function cacheMcpAppDownload(item: McpAppLocalDownload): Promise<CachedDownload> {
  return cacheDownload(item, CACHE_DIRECTORY)
}

/** Bytes, text or a URL written to a file under the cache `directoryName`, for the preview to show, save and share. */
export async function cacheDownload(item: McpAppLocalDownload, directoryName: string): Promise<CachedDownload> {
  const directory = new Directory(Paths.cache, directoryName)
  directory.create({ intermediates: true, idempotent: true })
  const file = new File(directory, safeCacheFileName(randomId(), item.name))
  const base = { name: item.name, mimeType: item.mimeType }
  if ('url' in item) {
    const downloaded = await File.downloadFileAsync(item.url, file)
    return { ...base, localUri: downloaded.uri, size: downloaded.size }
  }
  file.create({ overwrite: true })
  if ('text' in item) file.write(item.text)
  else file.write(item.base64, { encoding: 'base64' })
  return { ...base, localUri: file.uri, size: file.size }
}
