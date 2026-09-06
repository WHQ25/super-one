import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { wrapPathRefMention } from '@superone/shared/miniapp-prompt-tags'
import { wrapCapabilityMention } from '@superone/shared/capability-prompt-tags'
import { wrapAgentMention } from '@superone/shared/agent-mention-tags'
import { PortableUserText } from './PortableUserText'

describe('structured user mentions in the mobile transcript', () => {
  it.each([
    ['claude-work-review', 'claude-session'],
    ['codex-work-review', 'codex-session'],
    ['acp-base:grok-build', 'title="Grok"'],
    ['acp-base:opencode', 'title="OpenCode"'],
    ['opencode-base', 'title="OpenCode"'],
    ['cursor-base', 'title="Cursor"'],
    ['dsh-base', 'title="DeepSeek"'],
    ['acp-base:custom-agent', 'title="ACP"'],
  ])('renders the desktop brand mark for %s', (ref, marker) => {
    const html = renderToStaticMarkup(createElement(PortableUserText, { text: wrapAgentMention(ref, 'Reviewer') }))
    expect(html).toContain(marker)
    expect(html).toContain('mention-chip--blended')
    expect(html).toContain('Reviewer')
    expect(html).not.toContain('lucide-bot')
    expect(html).not.toContain('superone-agent')
  })
  it('keeps an unknown provider visible with a neutral fallback', () => {
    const html = renderToStaticMarkup(createElement(PortableUserText, { text: wrapAgentMention('future-base', 'Future') }))
    expect(html).toContain('lucide-bot')
    expect(html).toContain('Future')
    expect(html).not.toContain('codex-session')
  })
  it('renders selected file identity as a Symbols chip without leaking tag fields', () => {
    const html = renderToStaticMarkup(createElement(PortableUserText, { text: `查看 ${wrapPathRefMention('file', 'src/中文 file.ts', '中文 file.ts')} 然后测试` }))
    expect(html).toContain('data-mention-kind="file"')
    expect(html).toContain('mention-chip--resource')
    expect(html).toContain('<svg')
    expect(html).toContain('title="src/中文 file.ts"')
    expect(html).toContain('中文 file.ts')
    expect(html).not.toContain('superone-ref')
    expect(html).toContain('然后测试')
  })
  it('renders capabilities with the shared glyph and blended styling', () => {
    const html = renderToStaticMarkup(createElement(PortableUserText, { text: wrapCapabilityMention('debug', 'Debug') }))
    expect(html).toContain('mention-chip--blended')
    expect(html).toContain('lucide-bug')
    expect(html).toContain('text-rose-600')
    expect(html).not.toContain('superone-capability')
  })
  it('matches desktop directory tone and project-agent badge treatment', () => {
    const folder = renderToStaticMarkup(createElement(PortableUserText, { text: wrapPathRefMention('directory', 'src/', 'src') }))
    expect(folder).toContain('lucide-folder')
    expect(folder).toContain('text-primary')
    const agent = renderToStaticMarkup(createElement(PortableUserText, { text: wrapPathRefMention('agent', 'reviewer', 'reviewer') }))
    expect(agent).toContain('@reviewer')
    expect(agent).toContain('border-primary/40')
    expect(agent).not.toContain('lucide-bot')
  })
  it('renders host app artwork and shared desktop fallbacks', () => {
    const miniapp = '<superone-miniapp><appname>Board</appname><appid>board</appid></superone-miniapp>'
    const dynamic = renderToStaticMarkup(createElement(PortableUserText, {
      text: miniapp,
      mentionArtwork: { 'miniapp:board': 'cG5n' },
    }))
    expect(dynamic).toContain('data:image/png;base64,cG5n')
    expect(dynamic).toContain('rounded-[22%]')
    const defaultMiniapp = renderToStaticMarkup(createElement(PortableUserText, { text: miniapp }))
    expect(defaultMiniapp).toContain('fill="#F5F0EB"')
    const desktopApp = renderToStaticMarkup(createElement(PortableUserText, {
      text: '<superone-desktop-app><name>Editor</name><bundleId>com.example.Editor</bundleId></superone-desktop-app>',
    }))
    expect(desktopApp).toContain('lucide-mouse-pointer-2')
    expect(desktopApp).toContain('text-emerald-600')
  })
  it('keeps unselected @words, Markdown and HTML literal', () => {
    const html = renderToStaticMarkup(createElement(PortableUserText, { text: '@codex **literal** <script>alert(1)</script>' }))
    expect(html).not.toContain('data-mention-kind')
    expect(html).toContain('@codex **literal**')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})
