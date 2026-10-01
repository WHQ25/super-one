/** Images may load remote HTTPS or image data, never executable markup or host-local files. */
export function safeImageUri(src: unknown): string | undefined {
  if (typeof src !== 'string') return undefined
  if (/^data:image\/(?:svg\+xml|png|jpeg|gif|webp|avif|x-icon)(?:;[^,]*)?,/i.test(src)) return src
  try { const url = new URL(src); if (url.protocol === 'https:' && !url.username && !url.password) return url.href } catch { /* Invalid URL. */ }
  return undefined
}
