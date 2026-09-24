import { describe, expect, it } from 'vitest'
import { parsePartialWidgetInput, parseWidgetData } from './types'

describe('widget layout parsing', () => {
  it('carries an explicit layout through to the rendered widget', () => {
    expect(parseWidgetData({ widget_code: '<div/>', layout: 'fixed' })?.layout).toBe('fixed')
    expect(parseWidgetData({ widget_code: '<div/>', layout: 'fluid' })?.layout).toBe('fluid')
  })

  it('leaves the layout unset for a missing or unknown value, which renders fluid', () => {
    expect(parseWidgetData({ widget_code: '<div/>' })).not.toHaveProperty('layout')
    expect(parseWidgetData({ widget_code: '<div/>', layout: 'stretch' })).not.toHaveProperty('layout')
  })

  it('applies a layout streamed ahead of the code while the code is still arriving', () => {
    expect(parsePartialWidgetInput('{"title":"m","layout":"fixed","widget_code":"<div>')?.layout).toBe('fixed')
    expect(parsePartialWidgetInput('{"title":"m","widget_code":"<div>')).not.toHaveProperty('layout')
  })
})
