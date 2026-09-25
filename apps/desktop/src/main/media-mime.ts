import { MODEL_MIME } from '@superone/shared/file-preview'

export const MEDIA_MIME: Record<string, string> = {
  ...MODEL_MIME,
  '.bin': 'application/octet-stream', // external glTF buffer
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4', '.opus': 'audio/ogg', '.weba': 'audio/webm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
}

export const STREAMED_MEDIA_EXTS = new Set(Object.entries(MEDIA_MIME)
  .filter(([ext, mime]) => /^(?:video|audio)\//.test(mime) || ext in MODEL_MIME)
  .map(([ext]) => ext.slice(1)))
