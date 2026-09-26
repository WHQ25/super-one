import { describe, expect, it } from 'vitest'
import { mermaidPreviewDocument } from './mermaid-preview-document'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'

describe('mermaid preview document', () => {
  it('treats the SVG as data', () => {
    const html = mermaidPreviewDocument('</script><script>alert(1)</script><svg></svg>', '#111', false)
    expect(html).not.toContain('"</script>')
    expect(html).toContain('\\u003c/script>')
    expect(html).toContain("getElementById('stage').innerHTML=config.svg")
    expect(html).toContain('#111')
  })

  it('zooms with native page zoom so the vector re-tiles mid-gesture', () => {
    const html = mermaidPreviewDocument(SVG, '#000', false)
    expect(html).toContain('minimum-scale=1, maximum-scale=10')
    expect(html).not.toContain('user-scalable=no')
    expect(html).not.toContain('transform')
  })

  it('replaces smart zoom with a double-tap that pins native zoom until it lands', () => {
    const html = mermaidPreviewDocument(SVG, '#000', false)
    expect(html).toContain('touch-action:manipulation')
    expect(html).toContain('setViewport(pin,pin,pin)')
    expect(html).toMatch(/visualViewport\.width-width\)>1[^\n]*requestAnimationFrame\(settle\)/)
    expect(html).toContain('setViewport(CHROMIUM?scale:MIN,MIN,MAX)')
  })

  it('releases and centres the zoom the way each engine accepts', () => {
    const webkit = mermaidPreviewDocument(SVG, '#000', false)
    const chromium = mermaidPreviewDocument(SVG, '#000', true)
    expect(webkit).toContain('CHROMIUM=false')
    expect(chromium).toContain('CHROMIUM=true')
    expect(webkit).toContain('window.scrollTo(pageX-width/2,pageY-height/2)')
    expect(webkit).toContain("focus.scrollIntoView({block:'center',inline:'center'})")
    expect(webkit).toContain('<div id="focus" aria-hidden="true"></div>')
  })

  it('sizes the stage so a width="100%" mermaid SVG cannot collapse to 0', () => {
    const html = mermaidPreviewDocument(SVG, '#000', false)
    expect(html).toMatch(/#stage\{width:92vw;height:78vh\}/)
    expect(html).toMatch(/#stage svg\{[^}]*width:100%;height:100%/)
  })
})
