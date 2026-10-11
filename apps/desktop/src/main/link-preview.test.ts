import { describe, expect, it, vi } from 'vitest'

vi.mock('./favicon', () => ({ fetchPageHtml: vi.fn() }))

import { parseLinkPreview } from './link-preview'

const page = 'https://github.com/openai/codex/releases/tag/rust-v0.162.1'

describe('parseLinkPreview', () => {
  it('reads Open Graph tags in either attribute order, with entities decoded', () => {
    const html = `<html><head>
      <title>ignored</title>
      <meta property="og:title" content="Release 0.162.1 &middot; openai/codex">
      <meta content='Bug Fixes &#8212; Fixed a TUI crash &amp; more' property='og:description'>
      <meta property="og:site_name" content="GitHub" />
      <meta property="og:image" content="/assets/card.png">
    </head><body><meta property="og:title" content="body"></body></html>`
    expect(parseLinkPreview(html, page)).toEqual({
      title: 'Release 0.162.1 · openai/codex',
      description: 'Bug Fixes — Fixed a TUI crash & more',
      siteName: 'GitHub',
      image: 'https://github.com/assets/card.png',
    })
  })

  it('falls back to Twitter Card tags, then the title and description', () => {
    expect(parseLinkPreview(`<head><meta name="twitter:title" content="T"><meta name="twitter:image" content="https://x.dev/i.jpg"></head>`, page))
      .toEqual({ title: 'T', description: null, siteName: null, image: 'https://x.dev/i.jpg' })
    expect(parseLinkPreview(`<head><title> Plain   page </title><meta name="Description" content="About"></head>`, page))
      .toEqual({ title: 'Plain page', description: 'About', siteName: null, image: null })
  })

  it('drops a non-http image and returns null without any summary', () => {
    expect(parseLinkPreview(`<head><meta property="og:image" content="javascript:alert(1)"></head>`, page)).toBeNull()
    expect(parseLinkPreview('<html><body>nothing</body></html>', page)).toBeNull()
  })
})
