import { Directory, File, Paths } from 'expo-file-system'
import { Asset, requestPermissionsAsync } from 'expo-media-library'
import * as Sharing from 'expo-sharing'
import { Linking } from 'react-native'
import { FILE_PREVIEW_TEXT, type LocalSource, type SaveOutcome } from './file-preview-state'

export interface MediaPorts {
  share(source: LocalSource): Promise<void>
  save(source: LocalSource, toPhotos: boolean): Promise<SaveOutcome>
  openSettings(): void
}

const CACHE_DIRECTORY = 'file-preview'

const PHOTO_EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/webm': 'webm',
  'video/3gpp': '3gp',
}

const SAFE_PHOTO_FILE_PATTERN = /^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|gif|webp|heic|heif|bmp|mp4|mov|m4v|webm|3gp)$/

export function photoStagingFileName(name: string, mimeType: string, stamp = Date.now()): string {
  const rawExtension = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : ''
  const validExtension = /^(png|jpg|jpeg|gif|webp|heic|heif|bmp|mp4|mov|m4v|webm|3gp)$/.test(rawExtension)
    ? rawExtension
    : null
  const normalizedMime = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  const extension = PHOTO_EXTENSION_BY_MIME[normalizedMime]
    ?? validExtension
    ?? (normalizedMime.startsWith('video/') ? 'mp4' : 'jpg')
  const base = (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${base || 'media'}-${stamp}.${extension}`
}

export function isSafePhotoAssetUri(uri: string): boolean {
  const cleanUri = uri.split(/[?#]/)[0] ?? ''
  const lastSegment = cleanUri.split('/').pop() ?? ''
  return SAFE_PHOTO_FILE_PATTERN.test(lastSegment)
}

function writeInlineFile(source: Exclude<LocalSource, { kind: 'file' }>, fileName: string): File {
  const file = new File(Paths.cache, CACHE_DIRECTORY, fileName)
  file.create({ overwrite: true, intermediates: true })
  if (source.kind === 'text') file.write(source.text)
  else file.write(source.dataUri.slice(source.dataUri.indexOf(',') + 1).replace(/\s+/g, ''), { encoding: 'base64' })
  return file
}

function ensureFile(source: LocalSource): File {
  if (source.kind === 'file') return new File(source.uri)
  return writeInlineFile(source, source.name)
}

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
      if (toPhotos) {
        const permission = await requestPermissionsAsync(true)
        if (!permission.granted) return { kind: 'denied' }
        if (source.kind === 'file' && isSafePhotoAssetUri(source.uri)) {
          await Asset.create(source.uri)
          return { kind: 'saved', toPhotos: true }
        }
        const stagedName = photoStagingFileName(source.name, source.mimeType)
        let staged: File | null = null
        try {
          if (source.kind === 'file') {
            const targetDir = new Directory(Paths.cache, CACHE_DIRECTORY)
            targetDir.create({ intermediates: true, idempotent: true })
            staged = new File(targetDir, stagedName)
            if (staged.exists) staged.delete()
            new File(source.uri).copy(staged)
          } else {
            staged = writeInlineFile(source, stagedName)
          }
          await Asset.create(staged.uri)
          return { kind: 'saved', toPhotos: true }
        } finally {
          if (staged?.exists) {
            try { staged.delete() } catch {}
          }
        }
      }
      const file = ensureFile(source)
      const folder = await Directory.pickDirectoryAsync().catch((error: unknown) => {
        if (isCancellation(error)) return null
        throw error
      })
      if (!folder) return { kind: 'cancelled' }
      const target = folder.createFile(source.name, source.mimeType)
      target.write(await file.bytes())
      return { kind: 'saved', toPhotos: false }
    },

    openSettings() {
      void Linking.openSettings()
    },
  }
}
