import type { SessionWriteTarget } from '@/stores/chat'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { buildImageAttachmentFromBase64 } from '../chat/image-compress'

function imageNameFromUrl(url: string, mimeType: string): string {
  const ext = mimeType.split('/')[1]?.split('+')[0] || 'png'
  try {
    const base = new URL(url).pathname.split('/').pop() || ''
    if (base && /\.[a-z0-9]+$/i.test(base)) return decodeURIComponent(base)
  } catch {
    // ignore malformed URLs (e.g. data:) — fall through to a generic name
  }
  return `image.${ext}`
}

async function fetchImage(url: string): Promise<{ base64: string; mimeType: string } | null> {
  const res = await window.app.fetchBrowserImage(url)
  if (!res.ok || !res.mimeType.startsWith('image/')) return null
  return { base64: res.base64, mimeType: res.mimeType }
}

export async function addBrowserImageToChat(url: string, target?: SessionWriteTarget): Promise<boolean> {
  const img = await fetchImage(url)
  if (!img) return false
  const attachment = await buildImageAttachmentFromBase64(img.base64, img.mimeType, imageNameFromUrl(url, img.mimeType))
  if (!attachment) return false
  useChatStore.getState().addAttachment(attachment, target)
  return true
}

export async function saveBrowserImage(
  url: string,
): Promise<{ ok: boolean; canceled?: boolean; savedPath?: string; error?: string }> {
  const img = await fetchImage(url)
  if (!img) return { ok: false, error: 'fetch-failed' }
  const defaultDir = useAppStore.getState().currentFolder ?? undefined
  return window.app.saveBrowserImage(img.base64, img.mimeType, imageNameFromUrl(url, img.mimeType), defaultDir)
}

function isImageUrl(url: string): boolean {
  return /^data:image\//i.test(url) || /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico)(\?|#|$)/i.test(url)
}

export function extractDraggedImageUrl(dt: DataTransfer): string | null {
  // The <img src> inside text/html is the authoritative image URL. text/uri-list often carries
  // the enclosing link / page URL instead (e.g. an image on a media page), so it must not take
  // precedence over the actual image source.
  const html = dt.getData('text/html')
  const imgSrc = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]
  if (imgSrc) return imgSrc

  const text = dt.getData('text/plain').trim()
  const fromList = dt
    .getData('text/uri-list')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'))
  const candidate = fromList || text
  return candidate && isImageUrl(candidate) ? candidate : null
}
