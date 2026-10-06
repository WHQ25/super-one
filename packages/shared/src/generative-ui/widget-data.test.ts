import { describe, expect, it } from 'vitest'
import { buildWidgetData, injectWidgetData, readWidgetShowArgs, widgetDataFromInput } from './widget-data'

describe('readWidgetShowArgs', () => {
  it('keeps well-typed fields and drops the rest', () => {
    expect(readWidgetShowArgs({
      title: 'chart',
      widget_code: '<div/>',
      data: ['not', 'a', 'record'],
      reusable: 'nope',
      layout: 'sideways',
      width: '640',
      height: 300,
    })).toEqual({
      title: 'chart',
      widget_code: '<div/>',
      template: undefined,
      data: undefined,
      reusable: undefined,
      layout: undefined,
      width: undefined,
      height: 300,
    })
  })

  it('coerces a missing title to an empty string, as the host does', () => {
    expect(readWidgetShowArgs({ widget_code: '<div/>' }).title).toBe('')
  })
})

describe('buildWidgetData', () => {
  it('fills the size defaults and detects svg from the source', () => {
    expect(buildWidgetData({ title: 'd', source: '  <svg viewBox="0 0 1 1"></svg>' })).toEqual({
      title: 'd',
      widget_code: '  <svg viewBox="0 0 1 1"></svg>',
      width: 800,
      height: 600,
      isSVG: true,
    })
  })

  it('injects data ahead of the code without breaking out of the script', () => {
    const code = injectWidgetData('<svg/>', { evil: '</script><b>' })
    expect(code.startsWith('<script>window.widget=')).toBe(true)
    expect(code).not.toContain('</script><b>')
    expect(code.endsWith('</script><svg/>')).toBe(true)
    expect(buildWidgetData({ title: 'd', source: '<svg/>', data: { a: 1 } }).isSVG).toBe(true)
  })
})

describe('widgetDataFromInput', () => {
  const input = { title: 'chart', widget_code: '<div/>', data: { n: 1 }, layout: 'fixed', width: 640 }

  it('accepts the serialized input a transcript stores and the parsed one alike', () => {
    expect(widgetDataFromInput(JSON.stringify(input))).toEqual(widgetDataFromInput(input))
    expect(widgetDataFromInput(input)).toMatchObject({ title: 'chart', layout: 'fixed', width: 640, height: 600 })
  })

  it('has nothing to rebuild for a template call or an input without code', () => {
    expect(widgetDataFromInput({ title: 't', template: 'panel-a1b2c3d4' })).toBeNull()
    expect(widgetDataFromInput({ title: 't', widget_code: '<div/>', template: 'panel-a1b2c3d4' })).toBeNull()
    expect(widgetDataFromInput({ title: 't', widget_code: '' })).toBeNull()
  })

  it('rejects input that is not a JSON object', () => {
    expect(widgetDataFromInput('{"title": "half')).toBeNull()
    expect(widgetDataFromInput('["<div/>"]')).toBeNull()
  })
})
