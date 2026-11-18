import { beforeEach, expect, it, jest } from '@jest/globals'

type TrackedFile = {
  uri: string
  exists: boolean
  deleted: boolean
  written: unknown
}

const mockAssetCreate = jest.fn<(uri: string) => Promise<{ id: string }>>()
const mockRequestPermissions = jest.fn<(writeOnly?: boolean) => Promise<{ granted: boolean }>>()
const mockShareAsync = jest.fn<(uri: string, options?: object) => Promise<void>>()
const mockIsAvailableAsync = jest.fn<() => Promise<boolean>>()
const mockCreatedFiles: TrackedFile[] = []

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string
    exists = true
    written: unknown = null
    deleted = false

    constructor(...parts: Array<string | { uri: string }>) {
      const joined = parts
        .map((item) => (typeof item === 'string' ? item : item.uri).replace(/\/+$/, ''))
        .join('/')
      this.uri = joined.startsWith('file://') ? joined : `file://${joined}`
      mockCreatedFiles.push(this)
    }

    create() {
      this.exists = true
    }

    write(content: unknown) {
      this.written = content
    }

    copy(destination: MockFile) {
      destination.exists = true
    }

    delete() {
      this.exists = false
      this.deleted = true
    }

    async bytes() {
      return new Uint8Array([1, 2, 3])
    }
  }

  class MockDirectory {
    uri: string
    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts.map((item) => (typeof item === 'string' ? item : item.uri).replace(/\/+$/, '')).join('/')
    }
    create() {}
    createFile(name: string) {
      return new MockFile(this, name)
    }
    static pickDirectoryAsync = jest.fn()
  }

  return {
    Paths: { cache: { uri: 'file:///cache' } },
    Directory: MockDirectory,
    File: MockFile,
  }
})

jest.mock('expo-media-library', () => ({
  Asset: { create: (uri: string) => mockAssetCreate(uri) },
  requestPermissionsAsync: (writeOnly?: boolean) => mockRequestPermissions(writeOnly),
}))

jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockIsAvailableAsync(),
  shareAsync: (uri: string, options?: object) => mockShareAsync(uri, options),
}))

import { createMediaPorts, isSafePhotoAssetUri, photoStagingFileName } from './media-ports'

beforeEach(() => {
  mockCreatedFiles.length = 0
  mockAssetCreate.mockReset().mockResolvedValue({ id: 'asset-1' })
  mockRequestPermissions.mockReset().mockResolvedValue({ granted: true })
  mockIsAvailableAsync.mockReset().mockResolvedValue(true)
  mockShareAsync.mockReset().mockResolvedValue()
})

it('requests write-only permission and saves ASCII file URIs directly with Asset.create', async () => {
  const ports = createMediaPorts()
  const outcome = await ports.save(
    { kind: 'file', uri: 'file:///cache/transfer-1-preview.png', name: 'preview.png', mimeType: 'image/png' },
    true,
  )
  expect(outcome).toEqual({ kind: 'saved', toPhotos: true })
  expect(mockRequestPermissions).toHaveBeenCalledWith(true)
  expect(mockAssetCreate).toHaveBeenCalledWith('file:///cache/transfer-1-preview.png')
})

it('returns denied without creating an asset when write permission is refused', async () => {
  mockRequestPermissions.mockResolvedValueOnce({ granted: false })
  const ports = createMediaPorts()
  const outcome = await ports.save(
    { kind: 'file', uri: 'file:///cache/photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg' },
    true,
  )
  expect(outcome).toEqual({ kind: 'denied' })
  expect(mockAssetCreate).not.toHaveBeenCalled()
})

it('stages Chinese-named inline images to an ASCII file with a valid extension and cleans up', async () => {
  const ports = createMediaPorts()
  const outcome = await ports.save(
    {
      kind: 'dataUri',
      dataUri: 'data:image/png;base64,aGVsbG8=',
      name: '包装表面贴合效果',
      mimeType: 'image/png',
    },
    true,
  )
  expect(outcome).toEqual({ kind: 'saved', toPhotos: true })
  expect(mockAssetCreate).toHaveBeenCalledTimes(1)
  const createdUri = mockAssetCreate.mock.calls[0]![0]
  expect(createdUri).toMatch(/^file:\/\/\/cache\/file-preview\/media-\d+\.png$/)
  expect(isSafePhotoAssetUri(createdUri)).toBe(true)
  expect(mockCreatedFiles[0]?.deleted).toBe(true)
})

it('stages non-ASCII downloaded files before Asset.create and removes the temporary copy', async () => {
  const ports = createMediaPorts()
  const outcome = await ports.save(
    {
      kind: 'file',
      uri: 'file:///cache/req1-包装表面贴合效果.png',
      name: '包装表面贴合效果.png',
      mimeType: 'image/png',
    },
    true,
  )
  expect(outcome).toEqual({ kind: 'saved', toPhotos: true })
  const createdUri = mockAssetCreate.mock.calls[0]![0]
  expect(createdUri).toMatch(/^file:\/\/\/cache\/file-preview\/media-\d+\.png$/)
  const staged = mockCreatedFiles.find((file) => file.uri === createdUri)
  expect(staged?.deleted).toBe(true)
})

it('generates clean ASCII photo staging names across image and video MIME types', () => {
  expect(photoStagingFileName('包装表面贴合效果', 'image/png', 42)).toBe('media-42.png')
  expect(photoStagingFileName('demo clip (final).MP4', 'video/mp4', 99)).toBe('demo-clip-final-99.mp4')
  expect(isSafePhotoAssetUri('file:///cache/包装表面贴合效果.png')).toBe(false)
  expect(isSafePhotoAssetUri('file:///cache/photo_01.jpg')).toBe(true)
})
