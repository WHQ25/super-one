import { mkdir } from 'fs/promises'
import { isAbsolute, join, relative, resolve } from 'path'
import { Open as unzipOpen } from 'unzipper'

export function isUnsafeZipEntryPath(entryPath: string, destDir: string): boolean {
  const root = resolve(destDir)
  const target = resolve(join(root, entryPath))
  const rel = relative(root, target)
  return rel === '' || isAbsolute(rel) || rel.split(/[\\/]/).includes('..')
}

export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true })
  const root = resolve(destDir)
  const directory = await unzipOpen.file(zipPath)
  const entries = await directory.files
  for (const entry of entries) {
    if (isUnsafeZipEntryPath(entry.path, root)) {
      throw new Error(`Unsafe zip entry path: ${entry.path}`)
    }
  }
  await directory.extract({ path: root, concurrency: 4 })
}
