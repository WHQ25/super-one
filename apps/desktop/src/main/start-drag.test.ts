import { describe, it, expect, vi } from 'vitest'
import type { NativeImage } from 'electron'
import { imageDragThumbnail, planStartDrag, type StartDragDeps } from './start-drag'

const fakeIcon = (empty: boolean): NativeImage => ({ isEmpty: () => empty }) as unknown as NativeImage

function makeDeps(overrides: Partial<StartDragDeps> = {}): StartDragDeps {
  return {
    exists: () => true,
    createFromBuffer: () => fakeIcon(false),
    getFileIcon: async () => fakeIcon(false),
    ...overrides,
  }
}

const PNG = { png: new Uint8Array([1, 2, 3]).buffer }

describe('planStartDrag file-chip drag guard', () => {
  it('returns null when the dragged file does not exist (prevents native empty-icon crash)', async () => {
    const getFileIcon = vi.fn(async () => fakeIcon(true))
    const plan = await planStartDrag(['/gone/file.txt'], undefined, makeDeps({ exists: () => false, getFileIcon }))
    expect(plan).toBeNull()
    expect(getFileIcon).not.toHaveBeenCalled()
  })

  it('drops non-existent paths but still drags the existing ones', async () => {
    const exists = (p: string) => p === '/real.txt'
    const plan = await planStartDrag(['/gone.txt', '/real.txt'], undefined, makeDeps({ exists }))
    expect(plan?.files).toEqual(['/real.txt'])
  })

  it('uses the supplied png icon and skips getFileIcon when it is non-empty', async () => {
    const getFileIcon = vi.fn(async () => fakeIcon(false))
    const plan = await planStartDrag(['/real.txt'], PNG, makeDeps({ createFromBuffer: () => fakeIcon(false), getFileIcon }))
    expect(plan).not.toBeNull()
    expect(getFileIcon).not.toHaveBeenCalled()
  })

  it('falls back to getFileIcon when the supplied png decodes to an empty image', async () => {
    const getFileIcon = vi.fn(async () => fakeIcon(false))
    const plan = await planStartDrag(['/real.txt'], PNG, makeDeps({ createFromBuffer: () => fakeIcon(true), getFileIcon }))
    expect(plan).not.toBeNull()
    expect(getFileIcon).toHaveBeenCalledOnce()
  })

  it('returns null when even the fallback file icon is empty (never hands an empty icon to startDrag)', async () => {
    const plan = await planStartDrag(['/real.txt'], undefined, makeDeps({ getFileIcon: async () => fakeIcon(true) }))
    expect(plan).toBeNull()
  })

  it('returns null for a non-array payload', async () => {
    expect(await planStartDrag(undefined, undefined, makeDeps())).toBeNull()
  })
})

describe('imageDragThumbnail', () => {
  function sized(width: number, height: number, empty = false): NativeImage {
    const image = {
      isEmpty: () => empty,
      getSize: () => ({ width, height }),
      resize: ({ width: nextWidth, height: nextHeight }: { width: number; height: number }) => sized(nextWidth, nextHeight),
    }
    return image as unknown as NativeImage
  }

  it('shrinks a picture so the long side is 160', () => {
    expect(imageDragThumbnail(sized(800, 400), '/repo/shot.png')?.getSize()).toEqual({ width: 160, height: 80 })
  })

  it('keeps a picture that is already small enough', () => {
    const source = sized(120, 80)
    expect(imageDragThumbnail(source, '/repo/shot.jpg')).toBe(source)
  })

  it('leaves non-images and undecodable files to the file icon', () => {
    expect(imageDragThumbnail(sized(800, 400), '/repo/notes.txt')).toBeNull()
    expect(imageDragThumbnail(sized(800, 400, true), '/repo/shot.png')).toBeNull()
    expect(imageDragThumbnail(sized(0, 0), '/repo/shot.png')).toBeNull()
  })
})
