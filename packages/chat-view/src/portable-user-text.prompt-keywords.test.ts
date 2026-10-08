import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { wrapPathRefMention } from '@superone/shared/miniapp-prompt-tags'
import type { PromptKeyword } from '@superone/shared/prompt-keywords'
import { PortableUserText } from './portable-user-text.fixture'

const CLAUDE: PromptKeyword[] = ['ultrathink', 'ultracode']

/** The letters painted as `keyword`, joined. */
function painted(html: string, keyword: PromptKeyword): string {
  return [...html.matchAll(new RegExp(`class="prompt-keyword-${keyword}"[^>]*>([^<]*)<`, 'g'))].map((match) => match[1]).join('')
}

describe('prompt keywords in the mobile transcript', () => {
  it('paints the keywords letter by letter with the composer classes', () => {
    const html = renderToStaticMarkup(createElement(PortableUserText, { text: 'ultrathink, then ultracode it', promptKeywords: CLAUDE }))

    expect(painted(html, 'ultrathink')).toBe('ultrathink')
    expect(painted(html, 'ultracode')).toBe('ultracode')
    expect(html).toContain('--ultrathink-0')
    expect(html).toContain('--kw-index:8')
  })

  it('scans across a mention as the composer does', () => {
    const file = wrapPathRefMention('file', 'src/a.ts', 'a.ts')
    const html = renderToStaticMarkup(createElement(PortableUserText, { text: `"see ${file} ultracode" then ultrathink`, promptKeywords: CLAUDE }))

    expect(painted(html, 'ultracode')).toBe('')
    expect(painted(html, 'ultrathink')).toBe('ultrathink')
  })

  it('leaves the words plain when the harness reads no keywords', () => {
    const html = renderToStaticMarkup(createElement(PortableUserText, { text: 'ultrathink ultracode' }))

    expect(html).not.toContain('prompt-keyword-')
  })
})
