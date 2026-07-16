import { describe, it, expect } from 'vitest'
import { filenameFor } from './browser-download-store'

describe('download filename derivation', () => {
  it('prefers an explicit name over the url', () => {
    expect(filenameFor('chart.png', 'https://x.test/a/b.png', 'image/png')).toBe('chart.png')
  })

  it("falls back to the url's last path segment, decoded", () => {
    expect(filenameFor('', 'https://x.test/files/annual%20report.pdf', 'application/pdf')).toBe('annual report.pdf')
  })

  it('appends an extension inferred from the mime type when the name has none', () => {
    expect(filenameFor('export', 'https://x.test/export', 'text/csv')).toBe('export.csv')
    expect(filenameFor('', 'https://x.test/photo', 'image/jpeg')).toBe('photo.jpg')
  })

  it('keeps the existing extension even when it disagrees with the mime type', () => {
    expect(filenameFor('data.csv', 'https://x.test/data.csv', 'text/plain')).toBe('data.csv')
  })

  it('strips path traversal out of a hostile Content-Disposition name', () => {
    const name = filenameFor('../../../etc/passwd', 'https://x.test/x', 'text/plain')
    expect(name).toBe('passwd.txt')
    expect(name).not.toMatch(/[/\\]|\.\./)
  })

  it('strips traversal smuggled through the url path, including percent-encoded separators', () => {
    const name = filenameFor('', 'https://x.test/a/..%2f..%2fetc%2fshadow', 'text/plain')
    expect(name).toBe('shadow.txt')
    expect(name).not.toMatch(/[/\\]|\.\./)
  })

  it('replaces filesystem-reserved characters', () => {
    expect(filenameFor('a:b*c?.txt', 'https://x.test/x', 'text/plain')).toBe('a_b_c_.txt')
  })

  it('names data urls generically since they carry no path', () => {
    expect(filenameFor('', 'data:image/png;base64,AAAA', 'image/png')).toBe('download.png')
  })

  it('falls back to a generic name when nothing usable survives sanitizing', () => {
    expect(filenameFor('..', 'https://x.test/', 'application/octet-stream')).toBe('download.bin')
  })

  it('caps absurdly long names well under the filesystem limit, keeping an extension', () => {
    const name = filenameFor(`${'a'.repeat(300)}.txt`, 'https://x.test/x', 'text/plain')
    expect(name.length).toBeLessThanOrEqual(128)
    expect(name.endsWith('.txt')).toBe(true)
  })
})
