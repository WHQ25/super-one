import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorizeAndStat, FileBridgeError, readPreferInline } from '../file-bridge'
import { videoPosterService } from './video-poster'
import { readPhoneFile, readPhoneVideoPoster } from './phone-files'

vi.mock('../logger', () => ({ default: { error: vi.fn() } }))
vi.mock('../file-bridge', () => ({ authorizeAndStat: vi.fn(), readPreferInline: vi.fn(), FileBridgeError: class extends Error { constructor(public code: string, message: string) { super(message) } } }))
vi.mock('./video-poster', () => ({ videoPosterService: vi.fn(() => ({ posterFor: vi.fn() })) }))

const file = { realPath: '/host/movie.mp4', mimeType: 'video/mp4', name: 'movie.mp4', size: 100_000, modifiedAt: 42 }
const source = { deviceId: 'phone', transport: 'relay' as const }
const remote = { signLanFileUrl: vi.fn(async () => '/file/signed'), uploadFileToRelay: vi.fn(async () => ({ downloadUrl: 'https://file', expiresAt: 99, encryption: { version: 1, format: 'encrypted', key: 'fixture' } })) }
afterEach(() => vi.clearAllMocks())

describe('native phone file service', () => {
  it('retains the sensitive-file gate and answers before any transfer', async () => {
    vi.mocked(authorizeAndStat).mockRejectedValueOnce(new FileBridgeError('forbidden_path', 'sensitive file'))
    expect(await readPhoneFile({ path: '/host/.env' }, source, remote)).toEqual({ ok: false, error: 'forbidden_path', message: 'sensitive file' })
    expect(remote.uploadFileToRelay).not.toHaveBeenCalled()
    expect(readPreferInline).not.toHaveBeenCalled()
  })

  it('returns inline bytes before stat-only and avoids relay storage', async () => {
    vi.mocked(authorizeAndStat).mockResolvedValueOnce(file)
    vi.mocked(readPreferInline).mockResolvedValueOnce({ kind: 'bytes', bytes: Buffer.from('small') })
    expect(await readPhoneFile({ path: file.realPath, preferInline: true, statOnly: true, maxBytes: 123 }, source, remote)).toMatchObject({ ok: true, inline: true, base64: Buffer.from('small').toString('base64') })
    expect(authorizeAndStat).toHaveBeenCalledWith(file.realPath, { allowedRoots: [] }, { maxBytes: 123, skipRootCheck: true })
    expect(remote.uploadFileToRelay).not.toHaveBeenCalled()
  })

  it.each(['lan', 'relay'] as const)('transfers large files through the requesting %s link', async transport => {
    vi.mocked(authorizeAndStat).mockResolvedValueOnce(file)
    vi.mocked(readPreferInline).mockResolvedValueOnce({ kind: 'none' })
    const result = await readPhoneFile({ path: file.realPath, sessionId: 's' }, { ...source, transport }, remote)
    if (transport === 'lan') {
      expect(result).toMatchObject({ ok: true, url: '/file/signed' })
      expect(remote.signLanFileUrl).toHaveBeenCalledWith(file.realPath, { ttlMs: 60_000 })
      expect(remote.uploadFileToRelay).not.toHaveBeenCalled()
    } else {
      expect(result).toMatchObject({ ok: true, url: 'https://file', encryption: { key: 'fixture' } })
      expect(remote.uploadFileToRelay).toHaveBeenCalledWith(file.realPath, { mimeType: file.mimeType, size: file.size }, 's', source.deviceId)
      expect(remote.signLanFileUrl).not.toHaveBeenCalled()
    }
  })

  it('reads only the poster without applying the full-file size limit', async () => {
    vi.mocked(authorizeAndStat).mockResolvedValueOnce(file)
    const posterFor = vi.fn(async () => 'data:image/jpeg;base64,poster')
    vi.mocked(videoPosterService).mockReturnValueOnce({ posterFor } as unknown as ReturnType<typeof videoPosterService>)
    expect(await readPhoneVideoPoster({ path: file.realPath })).toMatchObject({ ok: true, poster: 'data:image/jpeg;base64,poster', size: file.size })
    expect(authorizeAndStat).toHaveBeenCalledWith(file.realPath, { allowedRoots: [] }, { maxBytes: Number.MAX_SAFE_INTEGER, skipRootCheck: true })
  })
})
