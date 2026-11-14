// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeSvg, svgDataUrl } from './svg'

describe('sanitizeSvg', () => {
  it('keeps drawing markup', () => {
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 2"><rect width="10" height="2" fill="#2e7d32"/></svg>')
    expect(out).toContain('<rect')
    expect(out).toContain('viewBox="0 0 10 2"')
  })
  it('drops scripts, event attributes, foreign elements and external links', () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>alert(1)</script><foreignObject><div/></foreignObject>'
      + '<a href="https://evil"><rect/></a><use href="https://evil/x.svg#a"/><use href="#ok"/>'
      + '<rect style="fill:url(https://evil)"/><rect fill="url(#g)"/></svg>',
    )!
    expect(out).not.toMatch(/script|onload|foreignObject|evil|<a/)
    expect(out).toContain('href="#ok"')
    expect(out).toContain('fill="url(#g)"')
  })
  it('drops style attributes and CSS-escaped values', () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:red"/><rect fill="\\75 rl(https://evil)"/><rect fill="red"/></svg>',
    )!
    expect(out).not.toMatch(/style|evil/)
    expect(out).toContain('fill="red"')
  })
  it('caps <use> so nesting cannot multiply without bound', () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect id="r"/>${'<use href="#r"/>'.repeat(40)}</svg>`)!
    expect(out.match(/<use/g)).toHaveLength(16)
  })
  it('refuses a document that is not an svg', () => {
    expect(sanitizeSvg('<html><body/></html>')).toBeNull()
    expect(svgDataUrl('not markup')).toBeNull()
  })
  it('keeps <style>, safe style attrs, and many <use> elements for backdrop svgs', () => {
    const out = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><style>.leaf{fill:#4b5f45}</style><path id="p" d="M0 0"/><g style="animation-delay:-2s">${'<use href="#p" class="leaf"/>'.repeat(40)}</g><style>@import url(https://evil);</style></svg>`,
      { backdrop: true },
    )!
    expect(out).toContain('<style>.leaf{fill:#4b5f45}</style>')
    expect(out).toContain('style="animation-delay:-2s"')
    expect(out.match(/<use/g)).toHaveLength(40)
    expect(out).not.toContain('evil')
  })
})
