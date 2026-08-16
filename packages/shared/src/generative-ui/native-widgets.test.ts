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
