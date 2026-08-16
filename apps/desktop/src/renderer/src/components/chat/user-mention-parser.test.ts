import { describe, it, expect } from 'vitest'
import { parseUserMentions, wrapPathRefMention } from './user-mention-parser'

describe('parseUserMentions', () => {
  it('returns empty array for empty input', () => {
    expect(parseUserMentions('')).toEqual([])
  })

  it('returns single text segment when no mention present', () => {
    expect(parseUserMentions('hello world')).toEqual([
      { type: 'text', text: 'hello world' },
    ])
  })

  it('keeps bare @tokens as plain text (only popup tags become chips)', () => {
    expect(parseUserMentions('@hello.py')).toEqual([
      { type: 'text', text: '@hello.py' },
    ])
    expect(parseUserMentions('看看 @hello_world.py 升级一下版本')).toEqual([
      { type: 'text', text: '看看 @hello_world.py 升级一下版本' },
    ])
    expect(parseUserMentions('@browser go')).toEqual([
      { type: 'text', text: '@browser go' },
    ])
    expect(parseUserMentions('@collab @computer @session')).toEqual([
      { type: 'text', text: '@collab @computer @session' },
    ])
    expect(parseUserMentions('@coder do it')).toEqual([
      { type: 'text', text: '@coder do it' },
    ])
  })

  it('does not match @ embedded in a word (e.g. email)', () => {
    expect(parseUserMentions('contact user@host.com please')).toEqual([
      { type: 'text', text: 'contact user@host.com please' },
    ])
  })

  it('parses superone-session tags', () => {
    expect(
      parseUserMentions(
        'see <superone-session><title>Fix auth</title><sessionId>sid-abc</sessionId></superone-session> please',
      ),
    ).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'mention', kind: 'session', value: 'sid-abc', displayName: 'Fix auth' },
      { type: 'text', text: ' please' },
    ])
  })

  it('strips superone-session-reminder blocks', () => {
    const text =
      'hi\n\n<superone-session-reminder>\nsessionId: x\n</superone-session-reminder>\n'
    expect(parseUserMentions(text)).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('parses popup-selected path ref tags as chips', () => {
    const file = wrapPathRefMention('file', 'src/main.ts', 'main.ts')
    const dir = wrapPathRefMention('directory', 'src/', 'src')
    const agent = wrapPathRefMention('agent', 'coder', 'coder')
    expect(parseUserMentions(`${file} ${dir} ${agent}`)).toEqual([
      { type: 'mention', kind: 'file', value: 'src/main.ts', displayName: 'main.ts' },
      { type: 'text', text: ' ' },
      { type: 'mention', kind: 'directory', value: 'src/', displayName: 'src' },
      { type: 'text', text: ' ' },
      { type: 'mention', kind: 'agent', value: 'coder', displayName: 'coder' },
    ])
  })

  it('preserves long trailing text as a single text segment', () => {
    const longBlob = 'x'.repeat(600)
    const input = `看看 @file.py 改一下\n${longBlob}`
    expect(parseUserMentions(input)).toEqual([
      { type: 'text', text: `看看 @file.py 改一下\n${longBlob}` },
    ])
  })

  describe('miniapp tags', () => {
    it('parses a miniapp tag into a mention segment', () => {
      const input = '<superone-miniapp><appname>Standalone Demo</appname><appid>standalone-demo</appid></superone-miniapp> increment please'
      expect(parseUserMentions(input)).toEqual([
        { type: 'mention', kind: 'miniapp', value: 'standalone-demo', displayName: 'Standalone Demo' },
        { type: 'text', text: ' increment please' },
      ])
    })

    it('parses miniapp tag with surrounding text', () => {
      const input = 'hey <superone-miniapp><appname>Notes</appname><appid>notes-app</appid></superone-miniapp> please help'
      expect(parseUserMentions(input)).toEqual([
        { type: 'text', text: 'hey ' },
        { type: 'mention', kind: 'miniapp', value: 'notes-app', displayName: 'Notes' },
        { type: 'text', text: ' please help' },
      ])
    })

    it('parses multiple miniapp tags', () => {
      const input = '<superone-miniapp><appname>A</appname><appid>a</appid></superone-miniapp> and <superone-miniapp><appname>B</appname><appid>b</appid></superone-miniapp>'
      expect(parseUserMentions(input)).toEqual([
        { type: 'mention', kind: 'miniapp', value: 'a', displayName: 'A' },
        { type: 'text', text: ' and ' },
        { type: 'mention', kind: 'miniapp', value: 'b', displayName: 'B' },
      ])
    })

    it('strips reminder block entirely from output', () => {
      const input = 'do the thing\n\n<superone-miniapp-reminder>\ntool info here\n</superone-miniapp-reminder>'
      expect(parseUserMentions(input)).toEqual([
        { type: 'text', text: 'do the thing' },
      ])
    })

    it('strips reminder block even when interleaved with miniapp tag', () => {
      const input = '<superone-miniapp><appname>App</appname><appid>app</appid></superone-miniapp> hello\n\n<superone-miniapp-reminder>\ntools\n</superone-miniapp-reminder>'
      expect(parseUserMentions(input)).toEqual([
        { type: 'mention', kind: 'miniapp', value: 'app', displayName: 'App' },
        { type: 'text', text: ' hello' },
      ])
    })

    it('keeps bare @file next to miniapp tags as plain text', () => {
      const input = '<superone-miniapp><appname>App</appname><appid>app</appid></superone-miniapp> look at @file.ts'
      expect(parseUserMentions(input)).toEqual([
        { type: 'mention', kind: 'miniapp', value: 'app', displayName: 'App' },
        { type: 'text', text: ' look at @file.ts' },
      ])
    })

    it('handles malformed miniapp tag as text fallback', () => {
      const input = '<superone-miniapp>broken</superone-miniapp> ok'
      // Tag does not match the strict format → left as text, no errors
      const result = parseUserMentions(input)
      expect(result).toEqual([{ type: 'text', text: input }])
    })
  })

  describe('built-in capability tags', () => {
    it('parses a capability tag into a mention segment', () => {
      const input = '<superone-capability><name>Super Browser</name><id>browser</id></superone-capability> open docs'
      expect(parseUserMentions(input)).toEqual([
        { type: 'mention', kind: 'browser', value: 'browser', displayName: 'Super Browser' },
        { type: 'text', text: ' open docs' },
      ])
    })

    it('parses all built-in capability kinds', () => {
      const input =
        '<superone-capability><name>Agents Collaboration</name><id>collab</id></superone-capability> ' +
        '<superone-capability><name>Computer Use</name><id>computer</id></superone-capability> ' +
        '<superone-capability><name>Super Browser</name><id>browser</id></superone-capability> ' +
        '<superone-capability><name>Widget</name><id>widget</id></superone-capability> ' +
        '<superone-capability><name>Debug</name><id>debug</id></superone-capability>'
      expect(parseUserMentions(input)).toEqual([
        { type: 'mention', kind: 'collab', value: 'collab', displayName: 'Agents Collaboration' },
        { type: 'text', text: ' ' },
        { type: 'mention', kind: 'computer', value: 'computer', displayName: 'Computer Use' },
        { type: 'text', text: ' ' },
        { type: 'mention', kind: 'browser', value: 'browser', displayName: 'Super Browser' },
        { type: 'text', text: ' ' },
        { type: 'mention', kind: 'widget', value: 'widget', displayName: 'Widget' },
        { type: 'text', text: ' ' },
        { type: 'mention', kind: 'debug', value: 'debug', displayName: 'Debug' },
      ])
    })

    it('strips capability reminder block entirely', () => {
      const input = 'use browser\n\n<superone-capability-reminder>\ntools\n</superone-capability-reminder>'
      expect(parseUserMentions(input)).toEqual([
        { type: 'text', text: 'use browser' },
      ])
    })

    it('does not chip plain @browser / @collab / @computer / @widget / @debug without popup tags', () => {
      expect(parseUserMentions('@browser go')).toEqual([
        { type: 'text', text: '@browser go' },
      ])
      expect(parseUserMentions('@collab help')).toEqual([
        { type: 'text', text: '@collab help' },
      ])
      expect(parseUserMentions('@computer click')).toEqual([
        { type: 'text', text: '@computer click' },
      ])
      expect(parseUserMentions('@widget chart')).toEqual([
        { type: 'text', text: '@widget chart' },
      ])
      expect(parseUserMentions('@debug crash')).toEqual([
        { type: 'text', text: '@debug crash' },
      ])
    })

    it('coexists with miniapp tags and path-ref file mentions', () => {
      const file = wrapPathRefMention('file', 'file.ts', 'file.ts')
      const input =
        '<superone-capability><name>Super Browser</name><id>browser</id></superone-capability> ' +
        '<superone-miniapp><appname>App</appname><appid>app</appid></superone-miniapp> see ' +
        file
      expect(parseUserMentions(input)).toEqual([
        { type: 'mention', kind: 'browser', value: 'browser', displayName: 'Super Browser' },
        { type: 'text', text: ' ' },
        { type: 'mention', kind: 'miniapp', value: 'app', displayName: 'App' },
        { type: 'text', text: ' see ' },
        { type: 'mention', kind: 'file', value: 'file.ts', displayName: 'file.ts' },
      ])
    })
  })
})
