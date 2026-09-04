import { describe, expect, it } from 'vitest'
import { parsePortableNativeWidgetResult, portableFileName } from './portable-native-widget'

const payload = JSON.stringify({
  kind: 'native',
  nativeType: 'image-gallery',
  title: 'Concepts',
  images: [{ id: 'image-1', type: 'image_generation', status: 'completed', savedPath: '/tmp/art.png' }],
})

describe('portable native widget', () => {
  it('parses direct and Codex string-wrapped native gallery results', () => {
    expect(parsePortableNativeWidgetResult(payload)?.nativeType).toBe('image-gallery')
    expect(parsePortableNativeWidgetResult(JSON.stringify(payload))?.title).toBe('Concepts')
  })

  it('falls back safely and derives portable basenames', () => {
    expect(parsePortableNativeWidgetResult('{bad')).toBeNull()
    expect(portableFileName('C:\\output\\clip.mp4')).toBe('clip.mp4')
  })
})
