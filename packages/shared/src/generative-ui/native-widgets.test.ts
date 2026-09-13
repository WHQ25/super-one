import { describe, it, expect } from 'vitest'
import {
  NATIVE_TEMPLATE_PREFIX,
  isNativeTemplateId,
  nativeTypeFromTemplateId,
  parseNativeWidgetResult,
} from './native-widgets'

describe('native widget template ids', () => {
  it('recognizes the reserved @native/ namespace', () => {
    expect(isNativeTemplateId('@native/image-gallery')).toBe(true)
    expect(isNativeTemplateId('@native/video-gallery')).toBe(true)
  })

  it('rejects saved template ids, which can never contain the prefix', () => {
    // template-store enforces /^[a-z0-9][a-z0-9_-]*$/, so a user template cannot collide.
    expect(isNativeTemplateId('mortgage-calculator')).toBe(false)
    expect(isNativeTemplateId('native/image-gallery')).toBe(false)
  })

  it('resolves only known native types, so a typo does not silently render nothing', () => {
    expect(nativeTypeFromTemplateId('@native/image-gallery')).toBe('image-gallery')
    expect(nativeTypeFromTemplateId('@native/video-gallery')).toBe('video-gallery')
    expect(nativeTypeFromTemplateId('@native/files-previewer')).toBe('files-previewer')
    expect(nativeTypeFromTemplateId('@native/image_gallery')).toBeNull()
    expect(nativeTypeFromTemplateId('@native/table')).toBeNull()
  })
})

describe('parseNativeWidgetResult — the single hide/collect predicate', () => {
  const payload = {
    kind: 'native',
    nativeType: 'image-gallery',
    title: 'seedream results',
    images: [{ id: 'g1-0', type: 'image_generation', status: 'completed', savedPath: '/tmp/a.png' }],
  }

  it('parses a native payload emitted by widget_show', () => {
    expect(parseNativeWidgetResult(JSON.stringify(payload))).toEqual(payload)
  })

  it('returns null for a code widget, so the widget block keeps rendering it', () => {
    const code = JSON.stringify({ title: 'chart', widget_code: '<svg/>', width: 800, height: 600, isSVG: true })
    expect(parseNativeWidgetResult(code)).toBeNull()
  })

  it('returns null for missing, non-JSON, and non-object results instead of throwing', () => {
    expect(parseNativeWidgetResult(undefined)).toBeNull()
    expect(parseNativeWidgetResult('')).toBeNull()
    expect(parseNativeWidgetResult('not json')).toBeNull()
    expect(parseNativeWidgetResult('"a string"')).toBeNull()
    expect(parseNativeWidgetResult('[]')).toBeNull()
  })

  it('returns null when nativeType is unknown, so a future type cannot blank the row on an old build', () => {
    const future = JSON.stringify({ ...payload, nativeType: 'table' })
    expect(parseNativeWidgetResult(future)).toBeNull()
  })

  it('drops items that are not render-ready, so hiding never trades a row for nothing', () => {
    const noPath = JSON.stringify({ ...payload, images: [{ id: 'x', type: 'image_generation', status: 'completed' }] })
    expect(parseNativeWidgetResult(noPath)).toBeNull()
  })
})

describe('parseNativeWidgetResult — files-previewer renders in place', () => {
  const file = { path: 'docs/a.png', absolutePath: '/repo/docs/a.png', name: 'a.png', kind: 'image', size: 10, note: 'the diagram' }
  const payload = { kind: 'native', nativeType: 'files-previewer', title: 'files', root: '/repo', files: [file] }

  it('parses a previewer payload with its root and rows', () => {
    expect(parseNativeWidgetResult(JSON.stringify(payload))).toEqual(payload)
  })

  it('keeps a missing row — order and count must match what the agent wrote', () => {
    const missing = { path: 'gone.txt', absolutePath: '/repo/gone.txt', name: 'gone.txt', kind: 'missing' }
    const parsed = parseNativeWidgetResult(JSON.stringify({ ...payload, files: [file, missing] }))
    expect(parsed?.files?.map((f) => f.kind)).toEqual(['image', 'missing'])
  })

  it('drops rows with an unknown kind (a payload from a newer build) rather than rendering a blank slide', () => {
    const parsed = parseNativeWidgetResult(JSON.stringify({ ...payload, files: [file, { ...file, kind: 'hologram' }] }))
    expect(parsed?.files).toHaveLength(1)
  })

  it('returns null for an empty file list or a missing root, so the ordinary tool row shows instead', () => {
    expect(parseNativeWidgetResult(JSON.stringify({ ...payload, files: [] }))).toBeNull()
    expect(parseNativeWidgetResult(JSON.stringify({ ...payload, root: undefined }))).toBeNull()
  })

  it('rejects a payload that also carries gallery items, which the turn-end collectors would show twice', () => {
    expect(parseNativeWidgetResult(JSON.stringify({ ...payload, images: [] }))).toBeNull()
  })
})
