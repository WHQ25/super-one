import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { MAX_UPLOAD_BYTES, type RelayClient } from '@superone/relay-client'
import { fileUriFromPath } from '@superone/shared/input-request'
import type { SchemaFormResource } from '@superone/shared/schema-form'
import { putFileBytes } from './attachments'
import { randomId } from './ids'

/** The host chooses the staging folder and binds the upload to this request/field. */
export async function pickInputRequestFile(options: {
  client: RelayClient; projectPath: string; sessionId: string; requestId: string; field: string
}): Promise<SchemaFormResource[]> {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false })
  if (result.canceled || !result.assets[0]) return []
  const asset = result.assets[0]
  const file = new File(asset.uri)
  if (Math.max(asset.size ?? 0, file.size) > MAX_UPLOAD_BYTES) throw new Error('File too large to upload (max 100 MB)')
  const bytes = await file.bytes()
  const mimeType = asset.mimeType ?? 'application/octet-stream'
  const savedPath = await options.client.uploadFile({
    requestId: randomId(), projectPath: options.projectPath, sessionId: options.sessionId,
    targetDir: options.projectPath, name: asset.name, mimeType, bytes,
    inputRequest: { requestId: options.requestId, field: options.field },
  }, putFileBytes)
  return [{ uri: fileUriFromPath(savedPath), name: asset.name, mimeType, size: bytes.byteLength }]
}
