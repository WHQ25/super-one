/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { captureAnchorDownload } from './office-xlsx-export'

describe('captureAnchorDownload', () => {
  it('returns the blob from the download anchor and restores the hooks', async () => {
    const originalClick = HTMLAnchorElement.prototype.click
    const originalRevoke = URL.revokeObjectURL
    const payload = new Uint8Array([80, 75, 3, 4])
    const captured = await captureAnchorDownload(() => {
      const url = URL.createObjectURL(new Blob([payload]))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'book.xlsx'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    })
    expect(Array.from(captured)).toEqual([80, 75, 3, 4])
    expect(HTMLAnchorElement.prototype.click).toBe(originalClick)
    expect(URL.revokeObjectURL).toBe(originalRevoke)
  })

  it('restores the hooks when the export throws', async () => {
    const originalClick = HTMLAnchorElement.prototype.click
    const originalRevoke = URL.revokeObjectURL
    await expect(captureAnchorDownload(() => { throw new Error('nope') })).rejects.toThrow('nope')
    expect(HTMLAnchorElement.prototype.click).toBe(originalClick)
    expect(URL.revokeObjectURL).toBe(originalRevoke)
  })
})
