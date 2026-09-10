import { describe, expect, it } from 'vitest'
import {
  checkDownloadPreconditions,
  classifyDownloadError,
  downloadFraction,
  MAX_UPDATE_APK_BYTES,
  verifyDownload,
} from './update-download-state'

describe('downloadFraction', () => {
  it('uses the reported total when the server sends one', () => {
    expect(downloadFraction(50, 200, 999)).toBe(0.25)
  })

  it('falls back to the manifest size when Content-Length is missing', () => {
    // expo-file-system reports -1 rather than throwing, which would otherwise
    // drop a perfectly knowable progress bar to indeterminate.
    expect(downloadFraction(50, -1, 200)).toBe(0.25)
  })

  it('clamps and gives up rather than reporting nonsense', () => {
    expect(downloadFraction(300, 200, 200)).toBe(1)
    expect(downloadFraction(50, -1, 0)).toBeNull()
    expect(downloadFraction(Number.NaN, 200, 200)).toBeNull()
    expect(downloadFraction(-1, 200, 200)).toBeNull()
  })
})

describe('checkDownloadPreconditions', () => {
  it('starts the download when there is room', () => {
    expect(
      checkDownloadPreconditions({ sizeBytes: 100_000_000, availableBytes: 1_000_000_000 }),
    ).toBeNull()
  })

  it('refuses a size only a corrupt manifest would carry', () => {
    expect(
      checkDownloadPreconditions({
        sizeBytes: MAX_UPDATE_APK_BYTES + 1,
        availableBytes: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe('too-large')
    expect(checkDownloadPreconditions({ sizeBytes: 0, availableBytes: 1 })).toBe('unknown')
  })

  it('refuses when the phone lacks room to install as well as store', () => {
    expect(
      checkDownloadPreconditions({ sizeBytes: 100_000_000, availableBytes: 150_000_000 }),
    ).toBe('disk-space')
  })

  it('proceeds when free space cannot be read, and lets the OS decide', () => {
    expect(checkDownloadPreconditions({ sizeBytes: 100, availableBytes: null })).toBeNull()
  })
})

describe('verifyDownload', () => {
  const expected = { expectedMd5: 'ABCDEF01', expectedSizeBytes: 100 }

  it('accepts a byte-exact download regardless of hash casing', () => {
    expect(
      verifyDownload({ ...expected, actualMd5: 'abcdef01', actualSizeBytes: 100 }),
    ).toBeNull()
  })

  it('catches a truncated or swapped file', () => {
    expect(verifyDownload({ ...expected, actualMd5: 'abcdef01', actualSizeBytes: 99 })).toBe(
      'checksum',
    )
    expect(verifyDownload({ ...expected, actualMd5: 'deadbeef', actualSizeBytes: 100 })).toBe(
      'checksum',
    )
  })

  it('accepts a matching size when the platform computed no hash', () => {
    // Refusing here would mean never updating on a platform that skips md5.
    expect(verifyDownload({ ...expected, actualMd5: null, actualSizeBytes: 100 })).toBeNull()
  })
})

describe('classifyDownloadError', () => {
  it('separates the failures worth wording differently', () => {
    expect(classifyDownloadError(new Error('The network connection was lost'))).toBe('network')
    expect(classifyDownloadError(new Error('Aborted'))).toBe('cancelled')
    expect(classifyDownloadError(new Error('ENOSPC: no space left on device'))).toBe('disk-space')
    expect(classifyDownloadError(new Error('something else entirely'))).toBe('unknown')
    expect(classifyDownloadError(undefined)).toBe('unknown')
  })
})
