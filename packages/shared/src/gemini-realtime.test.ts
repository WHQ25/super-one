import { describe, expect, it } from 'vitest'
import {
  GEMINI_LIVE_MODEL,
  GEMINI_TRANSCRIBE_MODEL,
  GeminiFrameError,
  appendGeminiTranscript,
  buildGeminiSetup,
  buildGeminiTranscribeSetup,
  decodeGeminiServerFrame,
  emptyGeminiVoiceLog,
  geminiLiveSocketUrl,
  geminiRealtimeAudio,
  geminiRealtimeText,
  geminiToolResponse,
  interpretGeminiServerEvent,
  noteGeminiFinal,
  noteGeminiInterim,
  notePartialFinal,
  notePartialInterim,
  parseGeminiServerEvent,
  redactGeminiText,
  rememberGeminiVoiceLine,
  takeGeminiDelegation,
} from './gemini-realtime'

const PCM = Uint8Array.from([1, 2, 3, 4])

describe('gemini live messages', () => {
  it('puts the key on the socket url and redacts it', () => {
    const url = geminiLiveSocketUrl('  live-key  ')
    expect(url).toContain('BidiGenerateContent?key=live-key')
    expect(redactGeminiText(url, 'live-key')).not.toContain('live-key')
    expect(redactGeminiText(url)).toContain('key=[REDACTED]')
    expect(() => geminiLiveSocketUrl(' ')).toThrow(GeminiFrameError)
  })

  it('opens a native-audio session with one empty tool', () => {
    const setup = buildGeminiSetup()
    expect(setup).toMatchObject({
      setup: {
        model: `models/${GEMINI_LIVE_MODEL}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
        },
        tools: [{ functionDeclarations: [{ name: 'delegate_task', behavior: 'NON_BLOCKING', parameters: { properties: {} } }] }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    })
    const instructions = ((setup.setup as { systemInstruction: { parts: Array<{ text: string }> } }).systemInstruction.parts[0]?.text) ?? ''
    expect(instructions).toContain('that it has started, then call it once')
    expect(instructions).toContain('Do not say the work is finished')
    expect(instructions).toContain('tell the user what it says')
    expect(instructions).toContain('Never refuse. Never tell the user you cannot do something.')
    expect(instructions).toContain('Call delegate_task so the backend agent does it.')
    expect(instructions).not.toContain('Do not answer that request yourself')
    expect(instructions).not.toMatch(/\p{Script=Han}/u)
    const tool = ((setup.setup as { tools: Array<{ functionDeclarations: Array<{ description: string }> }> }).tools[0]?.functionDeclarations[0])
    expect(tool?.description).toContain('Never refuse and never say you cannot')
    const kore = buildGeminiSetup({ voice: 'Kore' })
    expect(kore).toMatchObject({
      setup: { generationConfig: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } } },
    })
    expect(buildGeminiSetup({ voice: 'not-a-voice' })).toMatchObject({
      setup: { generationConfig: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } } } },
    })
  })

  it('concatenates incremental transcription instead of replacing the line', () => {
    expect(appendGeminiTranscript('', 'How can I ')).toEqual({ text: 'How can I ', delta: 'How can I ' })
    expect(appendGeminiTranscript('How can I ', 'help you today?')).toEqual({
      text: 'How can I help you today?',
      delta: 'help you today?',
    })
    expect(appendGeminiTranscript('What would ', 'you like to do?')).toEqual({
      text: 'What would you like to do?',
      delta: 'you like to do?',
    })
    expect(appendGeminiTranscript('How can I', 'How can I help you today?')).toEqual({
      text: 'How can I help you today?',
      delta: ' help you today?',
    })
    expect(appendGeminiTranscript('How can I help you today?', 'How can I')).toBeNull()
    expect(appendGeminiTranscript('hello', 'hello')).toBeNull()
  })

  it('replaces the live caption with each interim hypothesis, then with the final line', () => {
    const first = noteGeminiInterim({ final: '', interim: '' }, '你好')
    expect(first).toMatchObject({ text: '你好', open: true, replace: false })
    const next = noteGeminiInterim(first!.caption, '你好，帮我看一下')
    expect(next).toMatchObject({ text: '你好，帮我看一下', open: false, replace: true, caption: { interim: '你好，帮我看一下' } })
    expect(noteGeminiInterim(next!.caption, '你好，帮我看一下')).toBeNull()
    const final = noteGeminiFinal(next!.caption, '你好，帮我看一下当前目录')
    expect(final).toMatchObject({
      text: '你好，帮我看一下当前目录',
      open: false,
      replace: true,
      caption: { final: '你好，帮我看一下当前目录', interim: '' },
    })
    expect(noteGeminiFinal(final!.caption, '的结构')).toMatchObject({
      text: '你好，帮我看一下当前目录的结构',
      replace: false,
      delta: '的结构',
    })
    expect(noteGeminiInterim(final!.caption, '另一句猜测')).toBeNull()
  })

  it('sends the whole call the first time and only the new lines after that', () => {
    let log = emptyGeminiVoiceLog()
    log = rememberGeminiVoiceLine(log, 'user', '你好')
    log = rememberGeminiVoiceLine(log, 'assistant', '在。')
    const first = takeGeminiDelegation(log, '看一下当前目录')
    expect(first).toMatchObject({
      kind: 'opening',
      transcript: [
        { role: 'user', text: '你好' },
        { role: 'assistant', text: '在。' },
        { role: 'user', text: '看一下当前目录' },
      ],
    })
    expect(first?.log.sent).toBe(3)
    expect(takeGeminiDelegation(first!.log, '看一下当前目录')).toBeNull()
    const grown = rememberGeminiVoiceLine(first!.log, 'user', '看一下当前目录的结构')
    expect(grown.lines[2]).toEqual({ role: 'user', text: '看一下当前目录的结构' })
    expect(grown.sent).toBe(3)
    let later = rememberGeminiVoiceLine(first!.log, 'assistant', '目录里有三个文件。')
    later = rememberGeminiVoiceLine(later, 'user', '再列一下')
    const second = takeGeminiDelegation(later, '')
    expect(second).toMatchObject({
      kind: 'turn',
      transcript: [
        { role: 'assistant', text: '目录里有三个文件。' },
        { role: 'user', text: '再列一下' },
      ],
    })
    expect(second?.log.sent).toBe(5)
    const quiet = rememberGeminiVoiceLine(second!.log, 'assistant', '列完了。')
    expect(takeGeminiDelegation(quiet, '')).toBeNull()
    expect(quiet.sent).toBe(5)
  })

  it('opens a text-only caption session on the transcribe model', () => {
    expect(buildGeminiTranscribeSetup()).toEqual({
      setup: {
        model: `models/${GEMINI_TRANSCRIBE_MODEL}`,
        generationConfig: { responseModalities: ['TEXT'] },
        inputAudioTranscription: {},
      },
    })
  })

  it('grows the live caption while the speaker is still going', () => {
    const first = notePartialInterim({ committed: '', interim: '' }, '你好')
    expect(first).toMatchObject({ text: '你好', open: true, replace: false })
    const longer = notePartialInterim(first!.caption, '你好，帮我看一下')
    expect(longer).toMatchObject({ text: '你好，帮我看一下', open: false, replace: true })
    const committed = notePartialFinal(longer!.caption, '你好。')
    expect(committed).toMatchObject({ text: '你好。', caption: { committed: '你好。', interim: '' } })
    const next = notePartialInterim(committed!.caption, '帮我看一下当前目录')
    expect(next).toMatchObject({ text: '你好。帮我看一下当前目录', replace: true })
    expect(notePartialFinal(next!.caption, '你好。帮我看一下当前目录')).toMatchObject({
      text: '你好。帮我看一下当前目录',
      caption: { interim: '' },
    })
  })

  it('compresses context and can resume a call', () => {
    const resumed = buildGeminiSetup({ compressContext: true, resume: true, resumptionHandle: 'h1' })
    expect(resumed.setup).toMatchObject({
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: { handle: 'h1' },
    })
    const fresh = buildGeminiSetup({ compressContext: true, resume: true })
    expect(fresh.setup).toMatchObject({ sessionResumption: {} })
    expect(buildGeminiSetup().setup).not.toHaveProperty('contextWindowCompression')
    expect(buildGeminiSetup().setup).not.toHaveProperty('sessionResumption')
  })

  it('sends 16 kHz audio and a text turn', () => {
    expect(geminiRealtimeAudio(PCM)).toEqual({
      realtimeInput: {
        audio: { data: Buffer.from(PCM).toString('base64'), mimeType: 'audio/pcm;rate=16000' },
      },
    })
    expect(geminiRealtimeText('  你好 ')).toEqual({ realtimeInput: { text: '你好' } })
    expect(() => geminiRealtimeAudio(new Uint8Array())).toThrow(/empty/)
    expect(() => geminiRealtimeText('  ')).toThrow(/empty/)
  })

  it('returns the backend text for the model to speak when idle', () => {
    expect(geminiToolResponse([{ id: 'c1', name: 'delegate_task', result: '当前目录有 README.md。' }])).toEqual({
      toolResponse: {
        functionResponses: [{
          id: 'c1',
          name: 'delegate_task',
          response: { result: '当前目录有 README.md。', scheduling: 'WHEN_IDLE' },
        }],
      },
    })
    expect(geminiToolResponse([{ id: 'c1', name: 'delegate_task', result: 'Already handed off.', scheduling: 'SILENT' }])).toEqual({
      toolResponse: {
        functionResponses: [{
          id: 'c1',
          name: 'delegate_task',
          response: { result: 'Already handed off.', scheduling: 'SILENT' },
        }],
      },
    })
    expect(() => geminiToolResponse([])).toThrow(/call/)
  })
})

describe('gemini server notices', () => {
  it('reads setup, audio, transcripts, a tool call, and the end of the turn', () => {
    expect(interpretGeminiServerEvent(parseGeminiServerEvent('{"setupComplete":{}}'))).toEqual([
      { type: 'setup-complete' },
    ])
    const audio = interpretGeminiServerEvent({
      serverContent: {
        inputTranscription: { text: '你好' },
        outputTranscription: { text: '在。' },
        modelTurn: {
          parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.from(PCM).toString('base64') } }],
        },
        turnComplete: true,
      },
    })
    expect(audio).toEqual([
      { type: 'input-transcript', text: '你好' },
      { type: 'output-transcript', text: '在。' },
      { type: 'audio', pcm: PCM, sampleRate: 24000 },
      { type: 'turn-complete' },
    ])
    expect(interpretGeminiServerEvent({
      serverContent: {
        interimInputTranscription: { text: '看一下' },
        turnComplete: true,
      },
      toolCall: { functionCalls: [{ id: 'c1', name: 'delegate_task', args: {} }] },
    })).toEqual([
      { type: 'input-interim', text: '看一下' },
      { type: 'turn-complete' },
      { type: 'tool-call', calls: [{ id: 'c1', name: 'delegate_task', args: '{}' }] },
    ])
    expect(interpretGeminiServerEvent({
      serverContent: { interim_input_transcription: { text: 'hello' } },
    })).toEqual([{ type: 'input-interim', text: 'hello' }])
    expect(interpretGeminiServerEvent({
      toolCall: { functionCalls: [{ id: 'c1', name: 'delegate_task', args: {} }] },
    })).toEqual([
      { type: 'tool-call', calls: [{ id: 'c1', name: 'delegate_task', args: '{}' }] },
    ])
    expect(interpretGeminiServerEvent({ serverContent: { interrupted: true } })).toEqual([{ type: 'interrupted' }])
    expect(interpretGeminiServerEvent({ error: { message: 'bad key live-key' } })).toEqual([
      { type: 'error', message: 'bad key live-key' },
    ])
    expect(() => parseGeminiServerEvent('[]')).toThrow(/object/)
    const encoded = Buffer.from('{"setupComplete":{}}')
    expect(decodeGeminiServerFrame(encoded)).toBe('{"setupComplete":{}}')
    expect(interpretGeminiServerEvent(parseGeminiServerEvent(decodeGeminiServerFrame(encoded)))).toEqual([
      { type: 'setup-complete' },
    ])
    expect(() => decodeGeminiServerFrame(Uint8Array.from([0x0a, 0x02, 0xff]))).toThrow(/3 bytes, not JSON, prefix 0a02ff/)
    expect(interpretGeminiServerEvent({ goAway: { timeLeft: '60s' } })).toEqual([{ type: 'go-away' }])
    expect(interpretGeminiServerEvent({ sessionResumptionUpdate: { newHandle: 'h2' } })).toEqual([
      { type: 'resumption', handle: 'h2' },
    ])
  })

  it('redacts a key that the server echoes', () => {
    expect(interpretGeminiServerEvent({ error: { message: 'rejected live-key' } })).toEqual([
      { type: 'error', message: 'rejected live-key' },
    ])
    const url = geminiLiveSocketUrl('live-key')
    expect(redactGeminiText(`handshake failed ${url}`, 'live-key')).not.toContain('live-key')
  })
})
