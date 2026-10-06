import { describe, expect, it } from 'vitest'
import { buildWidgetData, injectWidgetData, readWidgetShowArgs, resolveWidgetCall, stripInjectedWidgetData, widgetDataFromInput, widgetShowShortContent } from './widget-data'

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

describe('resolveWidgetCall', () => {
  const input = JSON.stringify({ title: 'chart', widget_code: '<div>from input</div>' })
  const ack = 'Rendered widget "chart".'

  it('draws the payload a result carries ahead of the input', () => {
    const result = JSON.stringify({ title: 'chart', widget_code: '<div>from result</div>', width: 800, height: 600, isSVG: false })
    expect(resolveWidgetCall(input, result, true)?.widget_code).toBe('<div>from result</div>')
  })

  it('rebuilds a call whose result is only an acknowledgement from its input', () => {
    expect(resolveWidgetCall(input, ack, true)).toEqual(widgetDataFromInput(input))
  })

  it('keeps the widget of a call sealed without a result once its input was complete', () => {
    expect(resolveWidgetCall(input, undefined, true)).toEqual(widgetDataFromInput(input))
    expect(resolveWidgetCall('{"title":"chart","widget_code":"<div>half', undefined, true)).toBeNull()
  })

  it('previews a running call from its input, partial or complete', () => {
    expect(resolveWidgetCall('{"title":"chart","widget_code":"<div>half', undefined, false)?.widget_code).toBe('<div>half')
    expect(resolveWidgetCall(input, undefined, false)).toEqual(widgetDataFromInput(input))
  })

  it('has nothing to rebuild for a template call without a payload', () => {
    const template = JSON.stringify({ title: 'panel', template: 'panel-a1b2c3d4', data: { n: 1 } })
    expect(resolveWidgetCall(template, ack, true)).toBeNull()
    expect(resolveWidgetCall(template, undefined, false)).toBeNull()
  })
})

describe('stripInjectedWidgetData', () => {
  const PRELUDE = '<script>window.widget=Object.assign(window.widget||{},{data:'

  it('gives back the source a render injected data into', () => {
    expect(stripInjectedWidgetData(injectWidgetData('<div id="t"></div>', { rows: [1, 2], note: '</script><b>' }))).toBe('<div id="t"></div>')
  })

  it('removes every prelude stacked by saving a rendered template again', () => {
    expect(stripInjectedWidgetData(injectWidgetData(injectWidgetData('<svg/>', { n: 1 }), { n: 2 }))).toBe('<svg/>')
  })

  it('keeps a script that only resembles the prelude', () => {
    for (const code of [
      `${PRELUDE}[1,2]})</script><div/>`,
      `${PRELUDE}{oops})</script><div/>`,
      `${PRELUDE}{ "n": 1 }})</script><div/>`,
      `${PRELUDE}{"n":1}})`,
    ]) expect(stripInjectedWidgetData(code)).toBe(code)
  })

  it('leaves the widget\'s own scripts alone', () => {
    const own = '<script>window.widget={data:{n:1}}</script><div/>'
    expect(stripInjectedWidgetData(own)).toBe(own)
    expect(stripInjectedWidgetData(injectWidgetData(own, { n: 2 }))).toBe(own)
  })
})

describe('widgetShowShortContent', () => {
  it('acknowledges a call by its quoted title and nothing else', () => {
    expect(widgetShowShortContent({ title: 'release "builds"', widget_code: '<div>big widget</div>' }))
      .toEqual([{ type: 'text', text: 'Rendered widget "release \\"builds\\"".' }])
  })

  it('stays bounded whatever the widget holds', () => {
    const urls = Array.from({ length: 40 }, (_, i) => `https://evil.example/${'x'.repeat(i === 0 ? 5000 : 10)}${i}.js`)
    const title = '🧩发布'.repeat(400)
    const content = widgetShowShortContent({ title, widget_code: urls.map((url) => `<script src="${url}"></script>`).join('') })
    expect(content.map((part) => part.text).join('\n').length).toBeLessThan(2000)
    // The title is cut on a character, never inside a surrogate pair.
    expect(Array.from(JSON.parse(content[0]!.text.slice('Rendered widget '.length, -1)) as string)).toHaveLength(120)
    expect(content[1]!.text).toContain('40 URLs were blocked')
    expect(content[1]!.text).toContain('… and 35 more')
    expect(content[1]!.text).toContain('Re-call widget_show with corrected URLs')
  })
})
