import { OFFICE_PREVIEW_MAX_BYTES, officePreviewKind } from '@superone/shared/file-preview'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'

/**
 * Why a byte save must be refused before any path is resolved.
 * `null` means the caller may write the bytes to a local Office file.
 * Remote projects stay refused: their write API takes a UTF-8 string.
 */
export function officeBytesSaveRefusal(folderPath: string, filePath: string, byteLength: number): 'remote' | 'not-office' | 'size' | null {
  if (parseRemoteProjectKey(folderPath)) return 'remote'
  if (!officePreviewKind(filePath)) return 'not-office'
  if (!Number.isInteger(byteLength) || byteLength <= 0 || byteLength > OFFICE_PREVIEW_MAX_BYTES) return 'size'
  return null
}
