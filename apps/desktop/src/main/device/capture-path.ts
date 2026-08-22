/**
 * Naming a screenshot or recording on disk.
 *
 * Shared rather than per-platform: a capture from an emulator and one from a simulator
 * end up in the same place, get pasted into the same shell, and should sort together.
 */

/**
 * `iPhone-17-Pro-20260820-164452.png` — sortable by name, and free of the spaces
 * and punctuation that make a path awkward to paste into a shell.
 */
export function captureFileName(deviceName: string, extension: string, at: Date): string {
  const slug = deviceName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'device'
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
    + `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  return `${slug}-${stamp}.${extension}`
}
