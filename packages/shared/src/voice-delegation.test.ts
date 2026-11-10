import { describe, expect, it } from 'vitest'
import { parseRealtimeDelegation } from './realtime-timeline'
import {
  VOICE_COMMON_INSTRUCTIONS,
  VOICE_DELEGATION_PREAMBLE,
  VOICE_FALLBACK_SPOKEN,
  VOICE_UPLINK_FRAME_BYTES,
  buildVoiceInstructions,
  closedSpeakableBlocks,
  delegationIdleOutcome,
  extractSpokenSummary,
  mergeAsrText,
  slicePcm20ms,
  speakableAgentReply,
  stripVoiceAsides,
  visibleAssistantText,
  voiceDelegationContent,
} from './voice-delegation'

describe('voice delegation', () => {
  it('prepends shared identity, reply style, and general behavior to model instructions', () => {
    const prompt = buildVoiceInstructions(['Model specific rule.'])
    expect(prompt.split('\n')).toEqual([
      ...VOICE_COMMON_INSTRUCTIONS,
      'Model specific rule.',
    ])
  })
  it('replaces a rewritten hypothesis and still appends a short fragment', () => {
    expect(mergeAsrText('你怎么又不说话呢 hello hello', '你怎么又不说话呢哈喽哈喽')).toEqual({
      text: '你怎么又不说话呢哈喽哈喽',
      delta: '你怎么又不说话呢哈喽哈喽',
      replace: true,
    })
    expect(mergeAsrText('你好啊', '世界')).toEqual({ text: '你好啊世界', delta: '世界', replace: false })
    expect(mergeAsrText('你好', '你好呀')).toEqual({ text: '你好呀', delta: '呀', replace: false })
  })

  it('drops parenthetical stage directions from a spoken line', () => {
    expect(stripVoiceAsides('我这就开始帮你操作。 （等待执行中，按要求保持安静）')).toBe('我这就开始帮你操作。')
    expect(stripVoiceAsides('我这就帮你打开。 （等待执行，保持安静）')).toBe('我这就帮你打开。')
    expect(stripVoiceAsides('好的。(stay silent)')).toBe('好的。')
    expect(stripVoiceAsides('（等待执行，保持安静）')).toBe('')
    expect(stripVoiceAsides('我这就开始。（等待')).toBe('我这就开始。')
    expect(stripVoiceAsides('打开（新的）标签')).toBe('打开（新的）标签')
  })

  it('splits uplink audio into 20 ms frames', () => {
    const { frames, remainder } = slicePcm20ms(new Uint8Array(VOICE_UPLINK_FRAME_BYTES + 10))
    expect(frames).toHaveLength(1)
    expect(frames[0]).toHaveLength(640)
    expect(remainder).toHaveLength(10)
  })

  it('strips a short spoken tag and keeps an overlong one visible', () => {
    expect(extractSpokenSummary('Edited the file.\n<spoken>改好了。</spoken>')).toEqual({
      display: 'Edited the file.',
      spoken: '改好了。',
    })
    const long = '甲'.repeat(601)
    const extracted = extractSpokenSummary(`<spoken>${long}</spoken>`)
    expect(extracted.spoken).toHaveLength(600)
    expect(extracted.display).toBe(long)
    expect(extractSpokenSummary('no tag')).toEqual({ display: 'no tag', spoken: null })
    expect(VOICE_FALLBACK_SPOKEN).toBe('做完了')
    expect(VOICE_DELEGATION_PREAMBLE).not.toContain('<spoken>')
    expect(VOICE_DELEGATION_PREAMBLE).toContain('voice session')
    expect(VOICE_DELEGATION_PREAMBLE).toContain('Tables and code')
    expect(VOICE_DELEGATION_PREAMBLE).not.toMatch(/ordinary prose|skips markdown/)
    const envelope = voiceDelegationContent('看一下当前目录', [
      { role: 'user', text: '看一下当前目录' },
    ], 'opening')
    expect(parseRealtimeDelegation(envelope)).toMatchObject({
      source: 'handoff',
      input: '',
      transcript: [{ role: 'user', text: '看一下当前目录' }],
    })
    expect(envelope).not.toContain('<input>')
    expect(envelope.match(/看一下当前目录/g)).toEqual(['看一下当前目录'])
    expect(envelope).toContain('just started a voice session')
    expect(envelope).toContain('colloquial, concise')
    expect(envelope).not.toContain(VOICE_DELEGATION_PREAMBLE)
    const later = voiceDelegationContent('再看一下', [
      { role: 'assistant', text: '目录里有三个文件。' },
      { role: 'user', text: '再看一下' },
    ])
    expect(later).toContain(VOICE_DELEGATION_PREAMBLE)
    expect(later).not.toContain('<input>')
    expect(later.match(/再看一下/g)).toEqual(['再看一下'])
    expect(envelope.startsWith('<realtime_delegation>')).toBe(true)
    expect(visibleAssistantText('Edited.\n<spoken>改好了。</spoken>')).toBe('Edited.')
    expect(visibleAssistantText('Wait <spoken>还没说完')).toBe('Wait')
    expect(visibleAssistantText('plain')).toBe('plain')
  })

  it('keeps prose and drops tables, code, and images', () => {
    const reply = [
      '目录里有三个文件。',
      '',
      '| 名称 | 大小 |',
      '| --- | --- |',
      '| a.ts | 12 |',
      '',
      '```ts',
      'const n = 1',
      '```',
      '',
      '可以继续改。',
      '![shot](https://example.com/a.png)',
    ].join('\n')
    expect(speakableAgentReply(reply)).toBe('目录里有三个文件。\n\n可以继续改。')
  })

  it('reads a text block once it is no longer the open tail', () => {
    const streaming = {
      id: 'm1',
      role: 'assistant',
      status: 'streaming',
      content: [
        { type: 'text', id: 'a', text: '先说结论。' },
        { type: 'text', id: 'b', text: '还在写' },
      ],
    }
    expect(closedSpeakableBlocks([streaming], 0, false)).toEqual([
      { key: 'm1:a', display: '先说结论。', spoken: '先说结论。' },
    ])
    expect(closedSpeakableBlocks([streaming], 0, true)).toEqual([
      { key: 'm1:a', display: '先说结论。', spoken: '先说结论。' },
      { key: 'm1:b', display: '还在写', spoken: '还在写' },
    ])
    expect(closedSpeakableBlocks([
      {
        id: 'm2',
        role: 'assistant',
        status: 'streaming',
        content: [
          { type: 'text', id: 'a', text: '先说结论。' },
          { type: 'tool_use', id: 't' },
        ],
      },
    ], 0, false)).toEqual([{ key: 'm2:a', display: '先说结论。', spoken: '先说结论。' }])
    const table = '| 名称 | 大小 |\n| --- | --- |\n| a.ts | 12 |'
    const mixed = '目录里有三个文件。\n\n```ts\nconst n = 1\n```\n\n可以继续改。'
    expect(closedSpeakableBlocks([
      { id: 'old', role: 'assistant', status: 'complete', content: [{ type: 'text', text: '上一轮' }] },
      {
        id: 'm3',
        role: 'assistant',
        status: 'complete',
        content: [
          { type: 'text', id: 'table', text: table },
          { type: 'text', id: 'mixed', text: mixed },
          { type: 'text', id: 'prose', text: '看完了。' },
        ],
      },
    ], 1, false)).toEqual([
      { key: 'm3:table', display: table, spoken: '' },
      { key: 'm3:mixed', display: mixed, spoken: '目录里有三个文件。\n\n可以继续改。' },
      { key: 'm3:prose', display: '看完了。', spoken: '看完了。' },
    ])
  })

  it('does not finish the voice report on an idle from an earlier turn', () => {
    const settled = new Set<string>()
    expect(delegationIdleOutcome([
      { id: 'a0', role: 'assistant', status: 'complete' },
    ], 1, 1, settled)).toEqual({ settledIds: [], pending: 1, finishWatch: false })
    expect(delegationIdleOutcome([
      { id: 'a1', role: 'assistant', status: 'streaming' },
    ], 0, 1, settled)).toEqual({ settledIds: [], pending: 1, finishWatch: false })

    const first = delegationIdleOutcome([
      { id: 'a1', role: 'assistant', status: 'complete' },
      { id: 'a1b', role: 'assistant', status: 'complete' },
    ], 0, 2, settled)
    expect(first).toEqual({ settledIds: ['a1', 'a1b'], pending: 1, finishWatch: false })

    const second = delegationIdleOutcome([
      { id: 'a1', role: 'assistant', status: 'complete' },
      { id: 'a1b', role: 'assistant', status: 'complete' },
      { id: 'u2', role: 'user', status: 'complete' },
      { id: 'a2', role: 'assistant', status: 'complete' },
    ], 0, first.pending, new Set(first.settledIds))
    expect(second).toEqual({ settledIds: ['a2'], pending: 0, finishWatch: true })
  })
})
