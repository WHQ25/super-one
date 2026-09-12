import { describe, expect, it } from 'vitest'
import { deriveOtaView, OTA_IDLE } from './ota-update-state'

describe('OTA update view', () => {
  it('shows nothing on a launch that finds no update', () => {
    expect(deriveOtaView(OTA_IDLE)).toEqual({ phase: 'hidden' })
  })

  it('opens the gate as soon as an update is known, before any bytes move', () => {
    expect(deriveOtaView({ ...OTA_IDLE, isUpdateAvailable: true }))
      .toEqual({ phase: 'downloading', fraction: 0 })
  })

  it('reports native download progress while downloading', () => {
    expect(deriveOtaView({ ...OTA_IDLE, isUpdateAvailable: true, isDownloading: true, downloadProgress: 0.42 }))
      .toEqual({ phase: 'downloading', fraction: 0.42 })
  })

  it('clamps progress the native side reports out of range', () => {
    expect(deriveOtaView({ ...OTA_IDLE, isDownloading: true, downloadProgress: 1.4 }))
      .toEqual({ phase: 'downloading', fraction: 1 })
    expect(deriveOtaView({ ...OTA_IDLE, isDownloading: true, downloadProgress: Number.NaN }))
      .toEqual({ phase: 'downloading', fraction: null })
  })

  it('switches to restarting once the bundle is on disk, and stays there through the reload', () => {
    expect(deriveOtaView({ ...OTA_IDLE, isUpdatePending: true })).toEqual({ phase: 'restarting' })
    expect(deriveOtaView({ ...OTA_IDLE, isUpdatePending: true, isRestarting: true })).toEqual({ phase: 'restarting' })
  })

  it('drops the gate silently when the download failed', () => {
    expect(deriveOtaView({ ...OTA_IDLE, isUpdateAvailable: true, hasDownloadError: true }))
      .toEqual({ phase: 'hidden' })
  })

  it('drops the gate when the reload itself failed, whatever the native state says', () => {
    expect(deriveOtaView({ ...OTA_IDLE, isUpdatePending: true }, true)).toEqual({ phase: 'hidden' })
  })
})
