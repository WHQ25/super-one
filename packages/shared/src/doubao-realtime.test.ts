import { describe, expect, it } from 'vitest'
import { parseRealtimeDelegation } from './realtime-timeline'
import {
  DOUBAO_ACK_TEXT,
  DOUBAO_DEFAULT_SPEAKER,
  DOUBAO_DELEGATION_PREAMBLE,
  DOUBAO_FALLBACK_SPOKEN,
  DOUBAO_REALTIME_URL,
  DOUBAO_SEEDUPLEX_MODEL,
  DOUBAO_UPLINK_FRAME_BYTES,
  DoubaoFrameError,
  buildDoubaoStartSession,
  doubaoConnectionHeaders,
  doubaoDelegationContent,
  encodeSeeduplexEvent,
  extractSpokenSummary,
  visibleAssistantText,
  inputAudioAppend,
  inputAudioMute,
  interpretDoubaoServerEvent,
  isDoubaoRetryableStatus,
  parseSeeduplexEvent,
  readDoubaoHandshakeFailure,
  redactDoubaoText,
  responseCancel,
  stripVoiceAsides,
  sessionClose,
  slicePcm20ms,
  speechReplacementMessages,
  speechTextCommit,
  mergeAsrText,
  closedSpeakableBlocks,
  delegationIdleOutcome,
  speakableAgentReply,
  historyItemsEvent,
  recoverLeadingVoiceUsers,
  DOUBAO_HISTORY_PAIR_CAP,
} from './doubao-realtime'

const PCM = Uint8Array.from([1, 2, 3, 4])
const PCM_BASE64 = Buffer.from(PCM).toString('base64')

describe('doubao seeduplex events', () => {
  it('replaces a rewritten hypothesis and still appends a short fragment', () => {
    expect(mergeAsrText('你怎么又不说话呢 hello hello', '你怎么又不说话呢哈喽哈喽')).toEqual({
      text: '你怎么又不说话呢哈喽哈喽',
      delta: '你怎么又不说话呢哈喽哈喽',
      replace: true,
    })
    expect(mergeAsrText('你好啊', '世界')).toEqual({ text: '你好啊世界', delta: '世界', replace: false })
    expect(mergeAsrText('你好', '你好呀')).toEqual({ text: '你好呀', delta: '呀', replace: false })
  })

  it('opens the duplex socket with one API key', () => {
    expect(DOUBAO_REALTIME_URL).toBe('wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue')
    expect(doubaoConnectionHeaders({ apiKey: '  speech-key  ' })).toEqual({ 'X-Api-Key': 'speech-key' })
    expect(() => doubaoConnectionHeaders({ apiKey: ' ' })).toThrow(DoubaoFrameError)
  })

  it('creates a voice session that can delegate project work', () => {
    const event = buildDoubaoStartSession({ eventId: 'evt-1', speechRate: -10 })
    expect(event).toMatchObject({
      type: 'session.create',
      event_id: 'evt-1',
      session: {
        model: DOUBAO_SEEDUPLEX_MODEL,
        audio: {
          input: { format: { type: 'pcm', rate: 16_000 } },
          output: {
            format: { type: 'pcm_s16le', rate: 24_000 },
            speed: -10,
            voice: DOUBAO_DEFAULT_SPEAKER,
          },
        },
        tools: [{ type: 'function', name: 'delegate_task' }],
      },
    })
    expect(event.session).not.toHaveProperty('id')
    const instructions = (event.session as { instructions: string }).instructions
    expect(instructions).toContain('voice companion')
    expect(instructions).toContain('Do not call delegate_task.')
    expect(instructions).toContain('sends the conversation between you and the user to the backend agent')
    expect(instructions).toContain('The call returns immediately, but the work is asynchronous. A return does not mean the task is finished.')
    expect(instructions).toContain('briefly say, in the user\'s language, that it has started, then call it once')
    expect(instructions).toContain('Do not add any other explanation')
    expect(instructions).not.toMatch(/\p{Script=Han}/u)
    expect(instructions).toContain('Do not write a task')
    expect(instructions).toContain('only after a new request')
    const delegateLine = instructions.split('\n').findIndex(line => line.startsWith('delegate_task sends'))
    const asyncLine = instructions.split('\n').findIndex(line => line.startsWith('The call returns immediately'))
    const speakLine = instructions.split('\n').findIndex(line => line.startsWith('For project work'))
    expect(delegateLine).toBeGreaterThan(-1)
    expect(asyncLine).toBeGreaterThan(delegateLine)
    expect(speakLine).toBeGreaterThan(asyncLine)
    expect(instructions).toContain('The host forwards the backend agent\'s reply to you, and you read it aloud')
    expect(instructions).not.toContain('The host reads')
    const tool = (event.session as { tools: Array<{ parameters?: { properties?: object } }> }).tools[0]
    expect(tool?.parameters?.properties).toEqual({})
    expect(instructions).not.toContain('Say one short handoff')
    expect(instructions).not.toContain('<spoken>')
  })

  it('drops parenthetical stage directions from a spoken line', () => {
    expect(stripVoiceAsides('我这就开始帮你操作。 （等待执行中，按要求保持安静）')).toBe('我这就开始帮你操作。')
    expect(stripVoiceAsides('我这就帮你打开。 （等待执行，保持安静）')).toBe('我这就帮你打开。')
    expect(stripVoiceAsides('好的。(stay silent)')).toBe('好的。')
    expect(stripVoiceAsides('（等待执行，保持安静）')).toBe('')
    expect(stripVoiceAsides('我这就开始。（等待')).toBe('我这就开始。')
    expect(stripVoiceAsides('打开（新的）标签')).toBe('打开（新的）标签')
  })

  it('resumes a dialog by sending the server session id', () => {
    const event = buildDoubaoStartSession({ dialogId: 'dlg-1' })
    expect(event.session).toMatchObject({ id: 'dlg-1', model: '1.2.6.1' })
    expect(event).not.toHaveProperty('event_id')
  })

  it('rejects a clone speaker, a bad speech rate, and a long dialog id', () => {
    expect(() => buildDoubaoStartSession({ speaker: 'saturn_zh_female_keainvsheng_tob' })).toThrow(/Seeduplex/)
    expect(() => buildDoubaoStartSession({ speechRate: 101 })).toThrow(/speech rate/)
    expect(() => buildDoubaoStartSession({ speechRate: 1.5 })).toThrow(/speech rate/)
    expect(() => buildDoubaoStartSession({ dialogId: 'x'.repeat(129) })).toThrow(/dialog id/)
    expect(buildDoubaoStartSession({ speechRate: 100, speaker: 'en_female_dacey_uranus_bigtts' }).session).toMatchObject({
      audio: { output: { speed: 100, voice: 'en_female_dacey_uranus_bigtts' } },
    })
  })

  it('puts uplink audio in the audio field and paces 20 ms frames', () => {
    expect(inputAudioAppend(PCM, 'aud-1')).toEqual({
      type: 'input_audio_buffer.append',
      event_id: 'aud-1',
      audio: PCM_BASE64,
    })
    expect(inputAudioMute(true)).toEqual({ type: 'input_audio_mute.commit' })
    expect(inputAudioMute(false, 'mute-off')).toEqual({ type: 'input_audio_unmute.commit', event_id: 'mute-off' })
    const { frames, remainder } = slicePcm20ms(new Uint8Array(DOUBAO_UPLINK_FRAME_BYTES + 10))
    expect(frames).toHaveLength(1)
    expect(frames[0]).toHaveLength(640)
    expect(remainder).toHaveLength(10)
  })

  it('speaks host text with a replacement pair and keeps SayHello as a fallback', () => {
    expect(speechReplacementMessages(DOUBAO_ACK_TEXT, 'say-1')).toEqual([
      { type: 'speech_text_buffer.replacement.append', event_id: 'say-1', text: DOUBAO_ACK_TEXT },
      { type: 'speech_text_buffer.replacement.commit', event_id: 'say-1:end' },
    ])
    expect(speechTextCommit('你好呀')).toEqual({ type: 'speech_text_buffer.commit', text: '你好呀' })
    expect(responseCancel('stop-1')).toEqual({ type: 'response.cancel', event_id: 'stop-1' })
    expect(sessionClose()).toEqual({ type: 'session.close' })
  })

  it('round-trips one JSON event and rejects a frame that is not an event', () => {
    const text = encodeSeeduplexEvent({ type: 'session.close', event_id: 'end' })
    expect(parseSeeduplexEvent(text)).toEqual({ type: 'session.close', event_id: 'end' })
    expect(() => encodeSeeduplexEvent({})).toThrow(/type/)
    expect(() => parseSeeduplexEvent('not-json')).toThrow(/JSON/)
    expect(() => parseSeeduplexEvent('[]')).toThrow(/object/)
    expect(() => parseSeeduplexEvent('{"event_id":"x"}')).toThrow(/type/)
  })
})

describe('doubao server notices', () => {
  it('remembers the session id and treats transcription deltas as interim', () => {
    expect(interpretDoubaoServerEvent({
      type: 'session.created',
      session: { id: 'dlg-1' },
    })).toEqual({ type: 'session-started', dialogId: 'dlg-1' })
    expect(interpretDoubaoServerEvent({ type: 'session.updated' })).toEqual({ type: 'session-updated' })
    expect(interpretDoubaoServerEvent({ type: 'session.closed' })).toEqual({ type: 'session-finished' })
    expect(interpretDoubaoServerEvent({ type: 'response.done', usage: { input_text_tokens: 1 } })).toEqual({ type: 'usage' })
    expect(interpretDoubaoServerEvent({
      type: 'conversation.item.input_audio_transcription.delta',
      delta: '改',
    })).toEqual({ type: 'asr', text: '改', interim: true })
    expect(interpretDoubaoServerEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: '改一下',
    })).toEqual({ type: 'asr-ended', text: '改一下' })
    expect(interpretDoubaoServerEvent({
      type: 'conversation.item.input_audio_transcription.delta',
      results: [{ text: '你好', is_interim: true }, { text: '你好呀', is_interim: true }],
      delta: '呀',
    })).toEqual({ type: 'asr', text: '你好呀', interim: true })
  })

  it('decodes pcm_s16le audio and ignores a delta that is not base64', () => {
    expect(interpretDoubaoServerEvent({
      type: 'response.output_audio.started',
      text: '好',
      tts_type: 'chat_tts_text',
    })).toEqual({ type: 'tts-start', text: '好', ttsType: 'chat_tts_text' })
    expect(interpretDoubaoServerEvent({
      type: 'response.output_audio.delta',
      delta: PCM_BASE64,
    })).toEqual({ type: 'tts-audio', pcm: PCM })
    expect(interpretDoubaoServerEvent({
      type: 'response.output_audio.delta',
      audio: PCM_BASE64,
    })).toEqual({ type: 'tts-audio', pcm: PCM })
    expect(interpretDoubaoServerEvent({
      type: 'response.output_audio.delta',
      delta: '%%%',
    })).toEqual({ type: 'ignored', event: 'response.output_audio.delta' })
  })

  it('hangs up on the exit status and redacts a key echoed in an error', () => {
    expect(interpretDoubaoServerEvent({
      type: 'response.output_audio.done',
      status_code: '20000002',
    })).toEqual({ type: 'tts-ended', statusCode: '20000002', exitIntent: true })
    expect(interpretDoubaoServerEvent({
      type: 'response.output_audio.done',
    })).toEqual({ type: 'tts-ended', exitIntent: false })
    expect(interpretDoubaoServerEvent({
      type: 'error',
      error: { code: 50_000_000, message: 'ServerError X-Api-Key: secret-value' },
    })).toEqual({
      type: 'error',
      code: '50000000',
      message: 'ServerError X-Api-Key: [REDACTED]',
      retryable: true,
    })
    expect(interpretDoubaoServerEvent({
      type: 'error',
      code: '45000003',
      message: 'idle',
    })).toMatchObject({ type: 'error', retryable: false, code: '45000003' })
    expect(isDoubaoRetryableStatus(55000001)).toBe(true)
    expect(isDoubaoRetryableStatus(42000020)).toBe(false)
    expect(isDoubaoRetryableStatus('nope')).toBe(false)
  })

  it('keeps chat text and unknown events off the speech path', () => {
    expect(interpretDoubaoServerEvent({ type: 'response.output_text.delta', delta: '我来' })).toEqual({
      type: 'chat',
      content: '我来',
    })
    expect(interpretDoubaoServerEvent({ type: 'response.output_text.done' })).toEqual({ type: 'chat-ended' })
    expect(interpretDoubaoServerEvent({
      type: 'conversation.item.input_audio_transcription.started',
    })).toEqual({ type: 'asr-info' })
    expect(interpretDoubaoServerEvent({
      type: 'conversation.item.input_audio_transcription.failed',
      message: 'X-Api-Access-Key=secret-value',
    })).toEqual({ type: 'asr-failed', message: 'X-Api-Access-Key: [REDACTED]' })
    expect(interpretDoubaoServerEvent({ type: 'response.canceled' })).toEqual({ type: 'response-canceled' })
    expect(interpretDoubaoServerEvent({
      type: 'response.function_call_arguments.done',
      items: [{ call_id: 'call-1', name: 'delegate_task', arguments: '{"task":"看目录"}' }],
    })).toEqual({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{"task":"看目录"}' }],
    })
    expect(interpretDoubaoServerEvent({ type: 'input_audio_buffer.committed' })).toEqual({
      type: 'ignored',
      event: 'input_audio_buffer.committed',
    })
    expect(redactDoubaoText('failed X-Api-Access-Key=key')).toBe('failed X-Api-Access-Key: [REDACTED]')
  })

  it('reads the JSON body of a rejected upgrade', () => {
    expect(readDoubaoHandshakeFailure(
      401,
      '{"type":"error","error":{"type":"Unauthorized","code":"45000010","message":"Invalid X-Api-Key: secret-value"}}',
      'log-1',
    )).toEqual({
      status: 401,
      code: '45000010',
      message: 'Invalid X-Api-Key: [REDACTED]',
      logid: 'log-1',
    })
    expect(readDoubaoHandshakeFailure(400, 'not-json')).toEqual({ status: 400, message: 'not-json' })
  })
})

describe('doubao history injection', () => {
  it('keeps complete pairs and drops a trailing user line', () => {
    expect(historyItemsEvent([
      { role: 'assistant', text: '先开口' },
      { role: 'user', text: '你好', id: 'u1' },
      { role: 'assistant', text: '你好呀', id: 'a1' },
      { role: 'assistant', text: '还在。' },
      { role: 'user', text: '还在吗' },
      { role: 'system', text: '忽略' },
      { role: 'user', text: '   ' },
    ])).toEqual({
      type: 'conversation.item.create',
      items: [
        { id: 'u1', type: 'message', role: 'user', content: [{ type: 'input_text', text: '你好' }] },
        { id: 'a1', type: 'message', role: 'assistant', content: [{ type: 'input_text', text: '你好呀\n还在。' }] },
      ],
    })
    expect(historyItemsEvent([{ role: 'user', text: '只有一句' }])).toBeNull()
  })

  it('restores a user line that only survived inside the delegation', () => {
    const lines = recoverLeadingVoiceUsers(
      [{ role: 'assistant', text: '已经搜过了', id: 'a1' }],
      [`<realtime_delegation>
  <input>搜索</input>
  <transcript_delta>user: Hello，搜一下</transcript_delta>
</realtime_delegation>`],
    )
    expect(historyItemsEvent(lines)).toMatchObject({
      items: [
        { role: 'user', content: [{ text: 'Hello，搜一下' }] },
        { id: 'a1', role: 'assistant', content: [{ text: '已经搜过了' }] },
      ],
    })
    expect(recoverLeadingVoiceUsers(
      [{ role: 'user', text: 'Hello，搜一下' }, { role: 'assistant', text: '已经搜过了' }],
      ['<realtime_delegation><input>搜索</input><transcript_delta>user: Hello，搜一下</transcript_delta></realtime_delegation>'],
    )).toHaveLength(2)
  })

  it('keeps the newest twenty pairs', () => {
    const lines = Array.from({ length: DOUBAO_HISTORY_PAIR_CAP + 1 }, (_, index) => [
      { role: 'user', text: `问${index}`, id: `u${index}` },
      { role: 'assistant', text: `答${index}`, id: `a${index}` },
    ]).flat()
    const event = historyItemsEvent(lines)
    const items = event?.items as Array<{ id: string }>
    expect(items).toHaveLength(DOUBAO_HISTORY_PAIR_CAP * 2)
    expect(items[0]?.id).toBe('u1')
    expect(items.at(-1)?.id).toBe(`a${DOUBAO_HISTORY_PAIR_CAP}`)
  })
})

describe('doubao spoken summary', () => {
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
    expect(DOUBAO_FALLBACK_SPOKEN).toBe('做完了')
    expect(DOUBAO_DELEGATION_PREAMBLE).not.toContain('<spoken>')
    expect(DOUBAO_DELEGATION_PREAMBLE).toContain('voice session')
    expect(DOUBAO_DELEGATION_PREAMBLE).toContain('Tables and code')
    expect(DOUBAO_DELEGATION_PREAMBLE).not.toMatch(/ordinary prose|skips markdown/)
    const envelope = doubaoDelegationContent('看一下当前目录', [
      { role: 'user', text: '看一下当前目录' },
    ], 'opening')
    expect(parseRealtimeDelegation(envelope)).toMatchObject({
      source: 'handoff',
      input: '看一下当前目录',
      transcript: [{ role: 'user', text: '看一下当前目录' }],
    })
    expect(envelope).toContain('just started a voice session')
    expect(envelope).toContain('colloquial, concise')
    expect(envelope).not.toContain(DOUBAO_DELEGATION_PREAMBLE)
    const later = doubaoDelegationContent('再看一下', [{ role: 'user', text: '再看一下' }])
    expect(later).toContain(DOUBAO_DELEGATION_PREAMBLE)
    const ended = doubaoDelegationContent('语音会话已结束。', [], 'ended')
    expect(ended).toContain('voice session has ended')
    expect(parseRealtimeDelegation(ended)?.input).toBe('语音会话已结束。')
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
