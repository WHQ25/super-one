/**
 * Naming a screenshot or recording on disk.
 *
 * Shared rather than per-platform: a capture from an emulator and one from a simulator
 * end up in the same place, get pasted into the same shell, and should sort together.
 */
import { randomBytes } from 'node:crypto'

/**
 * Same-millisecond captures in this process must not share a name. Two random
 * bytes collide often enough that a burst of fifty does. A counter still fits
 * the four hex digits; the start is random so two processes rarely meet.
 */
let captureNonce = randomBytes(2).readUInt16BE(0)

function nextCaptureNonce(): string {
  const nonce = (captureNonce & 0xffff).toString(16).padStart(4, '0')
  captureNonce = (captureNonce + 1) & 0xffff
  return nonce
}

/**
 * `iPhone-17-Pro-20260820-164452-317-9f2c.png` — sortable by name, free of the spaces
 * and punctuation that make a path awkward to paste into a shell, and unique: two
 * captures inside one second used to collide, which is fatal once a desktop mirror
 * validates a node copy by size and mtime (session-sync-zone.md §4.2).
 */
export function captureFileName(deviceName: string, extension: string, at: Date): string {
  const slug = deviceName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'device'
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
    + `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
    + `-${String(at.getMilliseconds()).padStart(3, '0')}-${nextCaptureNonce()}`
  return `${slug}-${stamp}.${extension}`
}
