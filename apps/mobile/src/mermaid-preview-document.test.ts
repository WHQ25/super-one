import { describe, expect, it } from 'vitest'
import { mermaidPreviewDocument } from './mermaid-preview-document'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'

describe('mermaid preview document', () => {
  it('disables page zoom and treats the SVG as data', () => {
    const html = mermaidPreviewDocument('</script><script>alert(1)</script><svg></svg>', '#111')
    expect(html).toContain('user-scalable=no')
    expect(html).toContain('maximum-scale=1')
    expect(html).not.toContain('"</script>')
    expect(html).toContain('\\u003c/script>')
    expect(html).toContain('stage.innerHTML=config.svg')
    expect(html).toContain('#111')
  })

  it('owns pinch and pan as CSS transforms on this page', () => {
    const html = mermaidPreviewDocument(SVG, '#000')
    expect(html).toContain('\\u003csvg')
    expect(html).toContain('viewBox=')
    expect(html).toContain('touch-action:none')
    expect(html).toContain('event.preventDefault()')
    expect(html).toContain("mode='pinch'")
    expect(html).toContain('will-change:transform')
  })

  it('sizes the stage so a width="100%" mermaid SVG cannot collapse to 0', () => {
    const html = mermaidPreviewDocument(SVG, '#000')
    expect(html).toMatch(/#stage\{width:92vw;height:78vh;/)
    expect(html).toMatch(/#stage svg\{[^}]*width:100%;height:100%/)
  })
})
