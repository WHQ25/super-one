import { describe, it, expect } from 'vitest'
import { wrapMiniAppMention, findMiniAppMentionMarkers, MIRROR_MARKER } from './miniapp-mention-marker'
import { replaceMiniAppTagsWithMention } from './miniapp-prompt-tags'

describe('miniapp mention markers', () => {
  it('round-trips appId and name through invisible markers', () => {
    const wrapped = wrapMiniAppMention('standalone-demo', 'Standalone Demo')
    const matches = findMiniAppMentionMarkers(wrapped)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ appId: 'standalone-demo', appName: 'Standalone Demo' })
  })

  it('survives concatenation with surrounding plain text', () => {
    const wrapped = wrapMiniAppMention('notes-app', 'Notes')
    const text = `hey ${wrapped}  please open this`
    const matches = findMiniAppMentionMarkers(text)
    expect(matches).toHaveLength(1)
    expect(matches[0].appId).toBe('notes-app')
    expect(matches[0].appName).toBe('Notes')
    expect(text.slice(matches[0].start, matches[0].end)).toBe(wrapped)
  })

  it('decodes multi-byte (UTF-8) appIds and names', () => {
    const wrapped = wrapMiniAppMention('记事本-app', '记事本')
    const matches = findMiniAppMentionMarkers(wrapped)
    expect(matches[0].appId).toBe('记事本-app')
    expect(matches[0].appName).toBe('记事本')
  })

  it('finds multiple markers in one text', () => {
    const a = wrapMiniAppMention('a', 'App A')
    const b = wrapMiniAppMention('b-long-id', 'App B')
    const matches = findMiniAppMentionMarkers(`${a} and ${b}`)
    expect(matches.map((m) => m.appId)).toEqual(['a', 'b-long-id'])
  })

  it('ignores invalid marker pattern (no bits between markers)', () => {
    const broken = `${MIRROR_MARKER}${MIRROR_MARKER}@SomeApp${MIRROR_MARKER}`
    expect(findMiniAppMentionMarkers(broken)).toEqual([])
  })

  it('ignores plain @name without markers', () => {
    expect(findMiniAppMentionMarkers('plain @AppName text')).toEqual([])
  })

  it('the visible part of the wrapped string contains @Name', () => {
    const wrapped = wrapMiniAppMention('standalone-demo', 'Standalone Demo')
    const visible = wrapped.replace(/[⁣​‌]/g, '')
    expect(visible).toBe('@Standalone Demo')
  })
})

describe('replaceMiniAppTagsWithMention', () => {
  it('replaces superone-miniapp tag with marker-wrapped @name', () => {
    const input = '<superone-miniapp><appname>Standalone Demo</appname><appid>standalone-demo</appid></superone-miniapp> hello'
    const out = replaceMiniAppTagsWithMention(input)
    const matches = findMiniAppMentionMarkers(out)
    expect(matches).toHaveLength(1)
    expect(matches[0].appId).toBe('standalone-demo')
    expect(matches[0].appName).toBe('Standalone Demo')
    expect(out.endsWith(' hello')).toBe(true)
  })

  it('strips reminder block while preserving mention markers', () => {
    const input = '<superone-miniapp><appname>App</appname><appid>app</appid></superone-miniapp> do it\n\n<superone-miniapp-reminder>\ntool info\n</superone-miniapp-reminder>'
    const out = replaceMiniAppTagsWithMention(input)
    expect(out).not.toContain('superone-miniapp-reminder')
    expect(out).not.toContain('tool info')
    expect(findMiniAppMentionMarkers(out)).toHaveLength(1)
  })

  it('preserves newlines in surrounding text (no whitespace collapse)', () => {
    const input = '<superone-miniapp><appname>App</appname><appid>app</appid></superone-miniapp>\n\nline two'
    const out = replaceMiniAppTagsWithMention(input)
    expect(out).toContain('\n\nline two')
  })
})
