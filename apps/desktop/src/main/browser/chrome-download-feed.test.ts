import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  reserveDownloadPath: vi.fn(),
  wakeDownloadDelivery: vi.fn(),
}))
vi.mock('../agent/browser-download-store', () => ({
  reserveDownloadPath: store.reserveDownloadPath,
  wakeDownloadDelivery: store.wakeDownloadDelivery,
}))

const record = vi.hoisted(() => ({ sealZoneFile: vi.fn(), abandonZoneFile: vi.fn() }))
vi.mock('../environment/zone-delivery', () => ({
  sealZoneFile: record.sealZoneFile,
  abandonZoneFile: record.abandonZoneFile,
}))

const grants = vi.hoisted(() => ({ add: vi.fn() }))
vi.mock('../media-file-grants', () => ({ mediaFileGrants: () => grants }))

vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { chromeTargetId } from './cdp-transport'
import { rememberTabDriver } from './browser-tab-drivers'
import { chromePageDownloads, recordChromePageDownload, resetChromePageDownloadsForTests } from './chrome-download-feed'

const webContentsId = chromeTargetId(4)

function completed(path: string, guid = 'g1') {
  return {
    guid,
    url: 'https://x.test/export.csv',
    filename: 'export.csv',
    path,
    bytes: 3,
    state: 'completed' as const,
    startedAt: 1,
    webContentsId,
  }
}

describe('chrome page downloads', () => {
  let dir = ''

  afterEach(() => {
    resetChromePageDownloadsForTests()
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
    vi.clearAllMocks()
  })

  it('copies a finished download into a remote session zone, grants it, and seals it once', () => {
    dir = mkdtempSync(join(tmpdir(), 'chrome-page-'))
    const source = join(dir, 'from-chrome.csv')
    const target = join(dir, 'export.csv')
    writeFileSync(source, 'a,b')
    store.reserveDownloadPath.mockReturnValue(target)
    rememberTabDriver(webContentsId, 'sess-1', 'conn-1')

    recordChromePageDownload(completed(source))
    recordChromePageDownload({ ...completed(source), bytes: 9 })

    expect(readFileSync(target, 'utf8')).toBe('a,b')
    expect(grants.add).toHaveBeenCalledWith(source)
    expect(grants.add).toHaveBeenCalledWith(target)
    expect(record.sealZoneFile).toHaveBeenCalledTimes(1)
    expect(record.sealZoneFile).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      path: target,
      origin: 'page-download',
      connectionId: 'conn-1',
    })
    expect(store.wakeDownloadDelivery).toHaveBeenCalledTimes(1)
    expect(store.wakeDownloadDelivery).toHaveBeenCalledWith('conn-1')
    expect(chromePageDownloads()[0]).toMatchObject({ path: target, state: 'completed', bytes: 9 })
  })

  it('grants a local download in place and does not seal it', () => {
    dir = mkdtempSync(join(tmpdir(), 'chrome-page-'))
    const source = join(dir, 'local.csv')
    writeFileSync(source, 'z')
    rememberTabDriver(webContentsId, 'sess-local', null)

    recordChromePageDownload(completed(source, 'local'))

    expect(grants.add).toHaveBeenCalledWith(source)
    expect(store.reserveDownloadPath).not.toHaveBeenCalled()
    expect(record.sealZoneFile).not.toHaveBeenCalled()
    expect(chromePageDownloads()[0]?.path).toBe(source)
  })

  it('keeps the Chrome path when the zone copy fails', () => {
    rememberTabDriver(webContentsId, 'sess-1', 'conn-1')
    store.reserveDownloadPath.mockReturnValue('/tmp/zone/export.csv')

    recordChromePageDownload(completed('/no/such/chrome-file.csv', 'missing'))

    expect(record.abandonZoneFile).toHaveBeenCalledWith('sess-1', '/tmp/zone/export.csv')
    expect(record.sealZoneFile).not.toHaveBeenCalled()
    expect(chromePageDownloads()[0]?.path).toBe('/no/such/chrome-file.csv')
  })
})
