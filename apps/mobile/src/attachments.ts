import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { Alert } from 'react-native'
import { MAX_UPLOAD_BYTES, type HttpPut, type RelayClient } from '@superone/relay-client'
import type { ImageAttachment } from '@superone/shared/agent-types'
import { randomId } from './ids'
import { classifyAttachmentSize } from './attachment-limits'

export const MAX_CHAT_IMAGE_BYTES = 5 * 1_024 * 1_024
export const MAX_CHAT_PDF_BYTES = 20 * 1_024 * 1_024

export async function pickChatImages(limit: number): Promise<ImageAttachment[]> {
  if (limit <= 0) return []
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    base64: true,
    quality: 0.9,
    selectionLimit: limit,
  })
  if (result.canceled) return []
  return result.assets.map((asset, index): ImageAttachment => {
    if (!asset.base64) throw new Error('Selected image data is unavailable')
    const size = classifyAttachmentSize(asset.base64, asset.fileSize, MAX_CHAT_IMAGE_BYTES)
    if (size === 'invalid') throw new Error('Selected image data is invalid')
    if (size === 'too-large') throw new Error('Image too large to send to AI (max 5 MB)')
    return {
      id: asset.assetId ?? randomId(),
      name: asset.fileName ?? `image-${index + 1}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
      base64: asset.base64,
    }
  })
}

export async function pickChatPdf(): Promise<ImageAttachment | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    copyToCacheDirectory: true,
    multiple: false,
  })
  if (result.canceled) return null
  const asset = result.assets[0]
  if (!asset) return null
  const file = new File(asset.uri)
  if ((asset.size ?? 0) > MAX_CHAT_PDF_BYTES || file.size > MAX_CHAT_PDF_BYTES) {
    throw new Error('PDF too large to send to AI (max 20 MB)')
  }
  const base64 = await file.base64()
  const size = classifyAttachmentSize(base64, Math.max(asset.size ?? 0, file.size), MAX_CHAT_PDF_BYTES)
  if (size === 'invalid') throw new Error('Selected PDF data is invalid')
  if (size === 'too-large') throw new Error('PDF too large to send to AI (max 20 MB)')
  return {
    id: randomId(),
    name: asset.name,
    mimeType: 'application/pdf',
    base64,
  }
}

export const putFileBytes: HttpPut = async (url, bytes, mimeType) => {
  const body = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer as ArrayBuffer
    : bytes.slice().buffer as ArrayBuffer
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': mimeType },
    body,
  })
  if (!response.ok) throw new Error(`Upload PUT failed (${response.status})`)
  const text = await response.text()
  if (!text) return
  try {
    const parsed = JSON.parse(text) as { savedPath?: unknown }
    if (typeof parsed.savedPath === 'string') return { savedPath: parsed.savedPath }
  } catch { /* R2 may return a non-JSON response body */ }
}

export async function pickAndUploadProjectFile(opts: {
  client: RelayClient
  projectPath: string
  sessionId?: string
  /** Folder the file lands in. Defaults to the project root. */
  targetDir?: string
}): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false })
  if (result.canceled) return null
  const asset = result.assets[0]
  if (!asset) return null
  const file = new File(asset.uri)
  if ((asset.size ?? 0) > MAX_UPLOAD_BYTES || file.size > MAX_UPLOAD_BYTES) {
    throw new Error('File too large to upload (max 100 MB)')
  }
  const bytes = await file.bytes()
  return opts.client.uploadFile({
    requestId: randomId(),
    projectPath: opts.projectPath,
    ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    targetDir: opts.targetDir ?? opts.projectPath,
    name: asset.name,
    mimeType: asset.mimeType ?? 'application/octet-stream',
    bytes,
  }, putFileBytes)
}

export function showAttachmentMenu(actions: {
  image(): void
  pdf(): void
  file(): void
}): void {
  Alert.alert('Attach', undefined, [
    { text: 'Image · send to AI', onPress: actions.image },
    { text: 'PDF · send to AI', onPress: actions.pdf },
    { text: 'File · upload to project', onPress: actions.file },
    { text: 'Cancel', style: 'cancel' },
  ])
}
