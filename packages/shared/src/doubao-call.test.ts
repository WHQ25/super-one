import { describe, expect, it } from 'vitest'
import { DoubaoCallController, type DoubaoCallCommand } from './doubao-call'
import { VOICE_FALLBACK_SPOKEN } from './voice-delegation'

function sentTypes(commands: Array<{ type: string; event?: Record<string, unknown> }>): string[] {
  return commands.flatMap(command => command.type === 'send' ? [String(command.event?.type)] : [command.type])
}

function commitText(commands: DoubaoCallCommand[]): string | null {
  const commit = commands.find(command => command.type === 'send' && command.event.type === 'speech_text_buffer.commit')
  const text = commit?.type === 'send' ? commit.event.text : null
  return typeof text === 'string' ? text : null
}

function shows(commands: DoubaoCallCommand[], text: string): boolean {
  return commands.some(command => command.type === 'transcript' && command.text === text)
}

function toolReply(commands: DoubaoCallCommand[]): string {
  const tool = commands.find(command => command.type === 'send' && command.event.type === 'conversation.item.create')
  const items = tool?.type === 'send' ? tool.event.items : null
  if (!Array.isArray(items)) return ''
  const first = items[0] as { content?: Array<{ text?: string }> } | undefined
  return first?.content?.[0]?.text ?? ''
}

describe('Doubao call controller', () => {
  function started(): DoubaoCallController {
    const call = new DoubaoCallController()
    call.open()
    call.ingest({ type: 'session-started', dialogId: 'dialog-1' })
    return call
  }

  function clocked(read: () => number): DoubaoCallController {
    const call = new DoubaoCallController({ now: read })
    call.open()
    call.ingest({ type: 'session-started', dialogId: 'dialog-1' })
    return call
  }

  function delegated(call: DoubaoCallController): void {
    call.ingest({ type: 'asr-ended', text: '看一下当前目录' })
    call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{}' }],
    })
    // The opening line holds the readout until the start sentence finishes.
    call.ingest({ type: 'tts-start', text: '我这就开始', ttsType: 'default' })
    call.ingest({ type: 'tts-ended', exitIntent: false })
  }

  function finishHandoff(call: DoubaoCallController): void {
    call.ingest({ type: 'tts-start', text: '我先看一下', ttsType: 'default' })
    call.ingest({ type: 'tts-ended', exitIntent: false })
  }

  it('keeps a cumulative transcript as one line', () => {
    const call = started()
    call.ingest({ type: 'asr-info' })
    expect(call.ingest({ type: 'asr', text: '你好', interim: true })[0]).toMatchObject({ text: '你好' })
    expect(call.ingest({ type: 'asr', text: '你好呀', interim: true })[0]).toMatchObject({ text: '呀' })
    expect(call.ingest({ type: 'asr', text: '你好呀', interim: true })).toEqual([])
    const revised = call.ingest({ type: 'asr', text: '你好啊', interim: true })[0]
    expect(revised).toMatchObject({ text: '你好啊', replace: true })
    expect(call.ingest({ type: 'asr', text: '世界', interim: true })[0]).toMatchObject({ text: '世界' })
    const done = call.ingest({ type: 'asr-ended', text: '' })
    expect(done.find(command => command.type === 'transcript')).toMatchObject({ phase: 'completed', text: '你好啊世界' })
  })

  it('replaces a hypothesis that rewrites the ending instead of appending it', () => {
    const call = started()
    call.ingest({ type: 'asr-info' })
    call.ingest({ type: 'asr', text: '你怎么又不说话呢 hello hello', interim: true })
    const revised = call.ingest({ type: 'asr', text: '你怎么又不说话呢哈喽哈喽', interim: true })[0]
    expect(revised).toMatchObject({ text: '你怎么又不说话呢哈喽哈喽', replace: true })
    const again = call.ingest({ type: 'asr', text: '你怎么又不说话呢 hello', interim: true })[0]
    expect(again).toMatchObject({ text: '你怎么又不说话呢 hello', replace: true })
    const done = call.ingest({ type: 'asr-ended', text: '' })
    expect(done.find(command => command.type === 'transcript')).toMatchObject({
      phase: 'completed',
      text: '你怎么又不说话呢 hello',
    })
    const next = call.ingest({ type: 'asr', text: '你怎么又不说话呢', interim: true })
    const opened = next.find(command => command.type === 'transcript' && command.phase === 'started')
    const delta = next.find(command => command.type === 'transcript' && command.phase === 'delta')
    const previous = done.find(command => command.type === 'transcript' && command.phase === 'completed')
    expect(opened).toMatchObject({ role: 'user' })
    expect(delta).toMatchObject({ text: '你怎么又不说话呢', phase: 'delta' })
    expect(opened?.type === 'transcript' && previous?.type === 'transcript' && opened.itemId !== previous.itemId).toBe(true)
  })

  it('leaves a greeting with Doubao and does not start the backend', () => {
    const call = started()
    const commands = call.ingest({ type: 'asr-ended', text: '你好' })
    expect(commands.some(command => command.type === 'delegate')).toBe(false)
    const speech = call.ingest({ type: 'tts-start', text: '你好呀', ttsType: 'default' })
    expect(speech.some(command => command.type === 'transcript')).toBe(true)
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([1, 2]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([1, 2]) },
    ])
    expect(call.ingest({ type: 'chat', content: '你好' }).some(command => command.type === 'transcript')).toBe(true)
  })

  it('hides a parenthetical stage direction from the voice line', () => {
    const call = started()
    const said = call.ingest({ type: 'chat', content: '我这就帮你打开。 （等待执行，保持安静）' })
    expect(said.find(command => command.type === 'transcript')).toMatchObject({
      phase: 'started',
      role: 'assistant',
      text: '我这就帮你打开。',
    })
    expect(said.some(command => command.type === 'drop-playback')).toBe(false)
    expect(call.ingest({ type: 'chat', content: '打开（新的）标签' }).find(command => command.type === 'transcript'))
      .toMatchObject({ text: '打开（新的）标签' })
  })

  it('drops playback once a stage direction arrives after the sentence has started', () => {
    const call = started()
    call.ingest({ type: 'tts-start', text: '我这就开始帮你操作。', ttsType: 'default' })
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([1, 2, 3, 4]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([1, 2, 3, 4]) },
    ])
    const aside = call.ingest({ type: 'chat', content: ' （等待执行中，按要求保持安静）' })
    expect(aside.filter(command => command.type === 'transcript')).toEqual([])
    expect(aside).toContainEqual({ type: 'drop-playback' })
    expect(aside.some(command => command.type === 'send')).toBe(false)
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([5, 6]) })).toEqual([])
    const done = call.ingest({ type: 'tts-ended' })
    expect(done.find(command => command.type === 'transcript')).toMatchObject({
      phase: 'completed',
      text: '我这就开始帮你操作。',
    })
  })

  it('opens the backend on the first delegate and ignores a later call with no new speech', () => {
    const call = started()
    const heard = call.ingest({ type: 'asr-ended', text: '看一下当前目录' })
    expect(heard.some(command => command.type === 'delegate')).toBe(false)
    const commands = call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{}' }],
    })
    expect(commands.find(command => command.type === 'delegate')).toMatchObject({
      kind: 'opening',
      utterance: '看一下当前目录',
      continuing: false,
      transcript: [{ role: 'user', text: '看一下当前目录' }],
    })
    expect(toolReply(commands)).toContain('The task has started and is still running. It is not finished.')
    expect(toolReply(commands)).toContain('Say one short sentence now, in the user\'s language, that it has started.')
    expect(toolReply(commands)).toContain('Do not add anything else.')
    expect(toolReply(commands)).toContain('Do not say it is finished')
    expect(toolReply(commands)).not.toContain('Stay silent now')
    expect(toolReply(commands)).not.toContain('Already handed')
    expect(toolReply(commands)).not.toContain('好，我来处理')
    expect(toolReply(commands)).not.toContain('short natural sentence')
    const reply = call.ingest({ type: 'tts-start', text: '我先看一下', ttsType: 'default' })
    expect(reply.some(command => command.type === 'transcript')).toBe(true)
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([1, 2]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([1, 2]) },
    ])
    call.ingest({ type: 'tts-ended', exitIntent: false })
    expect(call.ingest({ type: 'tts-start', text: '我再补一句', ttsType: 'default' })).toEqual([])
    const again = call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-2', name: 'delegate_task', arguments: '{}' }],
    })
    expect(again.some(command => command.type === 'delegate')).toBe(false)
    expect(toolReply(again)).toContain('Already handed')
  })

  it('injects saved pairs once, and a resumed dialog does not inject them again', () => {
    const call = new DoubaoCallController({
      history: [
        { role: 'user', text: '你好', id: 'u1' },
        { role: 'assistant', text: '你好呀', id: 'a1' },
        { role: 'user', text: '还在吗' },
      ],
    })
    call.open()
    const startedCommands = call.ingest({ type: 'session-started', dialogId: 'dialog-1' })
    expect(startedCommands[0]).toMatchObject({
      type: 'send',
      event: {
        type: 'conversation.item.create',
        items: [
          { id: 'u1', type: 'message', role: 'user', content: [{ type: 'input_text', text: '你好' }] },
          { id: 'a1', type: 'message', role: 'assistant', content: [{ type: 'input_text', text: '你好呀' }] },
        ],
      },
    })
    call.open()
    const retried = call.ingest({ type: 'session-started', dialogId: 'dialog-1' })
    expect(retried.some(command => command.type === 'send')).toBe(false)
    expect(retried[0]).toMatchObject({ type: 'ready', dialogId: 'dialog-1' })
  })

  it('sends a later delegation only the lines since the previous handoff', () => {
    const call = started()
    expect(call.ingest({ type: 'asr-ended', text: '看一下当前目录' }).some(command => command.type === 'delegate')).toBe(false)
    const first = call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{}' }],
    })
    expect(first.find(command => command.type === 'delegate')).toMatchObject({
      kind: 'opening',
      transcript: [{ role: 'user', text: '看一下当前目录' }],
    })
    call.queueSummary('目录里有三个文件。')
    call.ingest({ type: 'asr-ended', text: '再列一下' })
    const second = call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-2', name: 'delegate_task', arguments: '{"task":"再列一下"}' }],
    })
    expect(second.find(command => command.type === 'delegate')).toMatchObject({
      transcript: [
        { role: 'assistant', text: '目录里有三个文件。' },
        { role: 'user', text: '再列一下' },
      ],
    })
  })

  it('includes an unfinished user line once', () => {
    const call = started()
    call.ingest({ type: 'asr-info' })
    call.ingest({ type: 'asr', text: '看一下', interim: true })
    const first = call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{"task":"看一下"}' }],
    })
    expect(first.find(command => command.type === 'delegate')).toMatchObject({
      kind: 'opening',
      transcript: [{ role: 'user', text: '看一下' }],
    })
    call.ingest({ type: 'asr-ended', text: '看一下' })
    call.queueSummary('好了。')
    // Ending the same line is not a new request, so the restatement is not sent.
    const restated = call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-2', name: 'delegate_task', arguments: '{"task":"再说"}' }],
    })
    expect(restated.some(command => command.type === 'delegate')).toBe(false)
    call.ingest({ type: 'asr-ended', text: '再说一遍' })
    const second = call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-3', name: 'delegate_task', arguments: '{"task":"再说一遍"}' }],
    })
    expect(second.find(command => command.type === 'delegate')).toMatchObject({
      transcript: [
        { role: 'assistant', text: '好了。' },
        { role: 'user', text: '再说一遍' },
      ],
    })
  })

  it('speaks each finished block as soon as the channel is free, including a repeated line', () => {
    const call = started()
    delegated(call)
    const first = call.queueSummary('目录里有三个文件。')
    expect(commitText(first)).toBe('目录里有三个文件。')
    expect(shows(first, '目录里有三个文件。')).toBe(true)
    const second = call.queueSummary('目录里有三个文件。')
    expect(commitText(second)).toBeNull()
    expect(shows(second, '目录里有三个文件。')).toBe(true)
    expect(call.ingest({ type: 'tts-start', text: '我先看一下', ttsType: 'default' })).toEqual([])
    call.ingest({ type: 'tts-start', text: '目录里有三个文件。', ttsType: 'chat_tts_text' })
    const next = call.ingest({ type: 'tts-ended', exitIntent: false })
    expect(commitText(next)).toBe('目录里有三个文件。')
  })

  it('keeps the reply that is already playing when the tool call arrives', () => {
    const call = started()
    call.ingest({ type: 'asr-ended', text: '看一下' })
    call.ingest({ type: 'tts-start', text: '我来看', ttsType: 'default' })
    const commands = call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{}' }],
    })
    expect(commands.some(command => command.type === 'drop-playback')).toBe(false)
    expect(commands.find(command => command.type === 'delegate')).toMatchObject({
      kind: 'opening',
      utterance: '看一下',
    })
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([1]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([1]) },
    ])
    const ended = call.ingest({ type: 'tts-ended', exitIntent: false })
    expect(ended.some(command => command.type === 'send' && command.event.type === 'conversation.item.create')).toBe(false)
    expect(commitText(ended)).toBeNull()
  })

  it('queues the agent reply while the start sentence is still speaking', () => {
    let now = 0
    const call = clocked(() => now)
    call.ingest({ type: 'asr-ended', text: '看一下当前目录' })
    const usage = call.ingest({ type: 'usage' })
    expect(usage.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    expect(usage.some(command => command.type === 'drop-playback')).toBe(false)
    const speech = call.ingest({ type: 'tts-start', text: '我这就开始', ttsType: 'default' })
    expect(speech.some(command => command.type === 'transcript')).toBe(true)
    expect(speech.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    call.ingest({ type: 'tts-audio', pcm: new Uint8Array(24_000 * 2) })
    const handed = call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{}' }],
    })
    expect(handed.find(command => command.type === 'delegate')).toMatchObject({ kind: 'opening' })
    expect(handed.some(command => command.type === 'drop-playback')).toBe(false)
    expect(handed.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    const queued = call.queueSummary('目录里有三个文件。')
    expect(shows(queued, '目录里有三个文件。')).toBe(true)
    expect(commitText(queued)).toBeNull()
    expect(queued.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    expect(queued.some(command => command.type === 'drop-playback')).toBe(false)
    const ended = call.ingest({ type: 'tts-ended', exitIntent: false })
    expect(commitText(ended)).toBeNull()
    expect(ended.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    expect(ended.some(command => command.type === 'drop-playback')).toBe(false)
    now = 100
    expect(call.isSpeaking()).toBe(true)
    expect(commitText(call.pump())).toBeNull()
    now = 1_000
    expect(call.isSpeaking()).toBe(false)
    expect(commitText(call.pump())).toBe('目录里有三个文件。')
  })

  it('lets only the user cut off the start sentence, and still reads the reply after a quiet model', () => {
    let now = 0
    const talking = clocked(() => now)
    talking.ingest({ type: 'asr-ended', text: '看一下当前目录' })
    talking.ingest({ type: 'tts-start', text: '我这就开始', ttsType: 'default' })
    talking.ingest({ type: 'tts-audio', pcm: new Uint8Array(24_000 * 2) })
    talking.ingest({ type: 'tts-ended', exitIntent: false })
    const handed = talking.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{}' }],
    })
    expect(handed.find(command => command.type === 'delegate')).toMatchObject({ kind: 'opening' })
    expect(handed.some(command => command.type === 'drop-playback')).toBe(false)
    talking.queueSummary('目录里有三个文件。')
    now = 100
    const barge = talking.barge()
    expect(barge.some(command => command.type === 'drop-playback')).toBe(true)
    expect(sentTypes(barge)).not.toContain('response.cancel')
    expect(talking.wantsSummary()).toBe(true)
    expect(commitText(talking.pump())).toBeNull()

    let later = 0
    const quiet = clocked(() => later)
    quiet.ingest({ type: 'asr-ended', text: '看一下当前目录' })
    expect(quiet.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{}' }],
    }).find(command => command.type === 'delegate')).toMatchObject({ kind: 'opening' })
    const waiting = quiet.queueSummary('目录里有三个文件。')
    expect(commitText(waiting)).toBeNull()
    expect(waiting.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    later = 800
    expect(commitText(quiet.pump())).toBeNull()
    expect(quiet.pump().some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    later = 2_000
    expect(commitText(quiet.pump())).toBe('目录里有三个文件。')
  })

  it('plays the confirmation that arrives after the tool result', () => {
    let now = 0
    const call = clocked(() => now)
    call.ingest({ type: 'asr-ended', text: '看一下当前目录' })
    const handed = call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{}' }],
    })
    expect(toolReply(handed)).toContain('Say one short sentence now')
    call.queueSummary('目录里有三个文件。')
    now = 1_000
    expect(commitText(call.pump())).toBeNull()
    expect(call.pump().some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    const speech = call.ingest({ type: 'tts-start', text: '我这就开始', ttsType: 'default' })
    expect(speech.find(command => command.type === 'transcript')).toMatchObject({ text: '我这就开始' })
    expect(speech.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([1, 2, 3, 4]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([1, 2, 3, 4]) },
    ])
    expect(commitText(call.ingest({ type: 'tts-ended', exitIntent: false }))).toBe('目录里有三个文件。')
    expect(call.ingest({ type: 'tts-start', text: '我再补一句', ttsType: 'default' })).toEqual([])
  })

  it('drops playback when the user talks over the report, and still reports if they only open the mic', () => {
    const call = started()
    delegated(call)
    finishHandoff(call)
    call.queueSummary('改好了')
    call.ingest({ type: 'tts-start', text: '改好了', ttsType: 'chat_tts_text' })
    const barge = call.ingest({ type: 'asr-info' })
    expect(sentTypes(barge)).toContain('response.cancel')
    expect(barge.some(command => command.type === 'drop-playback')).toBe(true)
    expect(commitText(call.ingest({ type: 'tts-ended', exitIntent: false }))).toBeNull()
    expect(call.wantsSummary()).toBe(false)
    expect(commitText(call.ingest({ type: 'asr-ended', text: '' }))).toBeNull()
    expect(call.queueSummary('下一块。')).toEqual([])

    const waiting = started()
    delegated(waiting)
    const noise = waiting.ingest({ type: 'asr-info' })
    expect(noise.some(command => command.type === 'drop-playback')).toBe(true)
    expect(noise.some(command => command.type === 'send')).toBe(false)
    expect(waiting.wantsSummary()).toBe(true)
    expect(commitText(waiting.ingest({ type: 'asr-ended', text: '' }))).toBeNull()
    const waitingBlock = waiting.queueSummary('改好了')
    expect(shows(waitingBlock, '改好了')).toBe(true)
    expect(commitText(waitingBlock)).toBe('改好了')
  })

  it('drops an in-flight readout when the user speaks before the audio starts, then answers them', () => {
    const call = started()
    delegated(call)
    expect(commitText(call.queueSummary('改好了'))).toBe('改好了')
    const barge = call.ingest({ type: 'asr-info' })
    expect(sentTypes(barge)).toContain('response.cancel')
    expect(call.wantsSummary()).toBe(false)
    expect(call.ingest({ type: 'tts-start', text: '改好了', ttsType: 'chat_tts_text' })).toEqual([])
    call.ingest({ type: 'asr-ended', text: '先别念了' })
    const reply = call.ingest({ type: 'tts-start', text: '好', ttsType: 'default' })
    expect(reply.some(command => command.type === 'play' || command.type === 'transcript')).toBe(true)
    expect(reply.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
  })

  it('reads a block without waiting for a handoff sentence', () => {
    const call = started()
    delegated(call)
    expect(call.ingest({ type: 'usage' })).toEqual([])
    expect(call.ingest({ type: 'tts-start', text: '行', ttsType: 'default' })).toEqual([])
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([3]) })).toEqual([])

    const queued = started()
    delegated(queued)
    const waitingBlock = queued.queueSummary('先说这一块。')
    expect(shows(waitingBlock, '先说这一块。')).toBe(true)
    expect(commitText(waitingBlock)).toBe('先说这一块。')
  })

  it('plays the committed block while a later model line cannot cancel it', () => {
    const call = started()
    delegated(call)
    finishHandoff(call)
    expect(commitText(call.queueSummary('目录里有三个文件。'))).toBe('目录里有三个文件。')
    call.ingest({ type: 'tts-start', text: '目录里有三个文件。', ttsType: 'chat_tts_text' })
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([9, 9]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([9, 9]) },
    ])
    const follow = call.ingest({ type: 'tts-start', text: '我再补充', ttsType: 'default' })
    expect(follow.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)

    const unlabeled = started()
    delegated(unlabeled)
    finishHandoff(unlabeled)
    unlabeled.queueSummary('看完了。')
    unlabeled.ingest({ type: 'tts-start', text: '看完了。' })
    expect(unlabeled.ingest({ type: 'tts-audio', pcm: Uint8Array.from([4]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([4]) },
    ])
  })

  it('speaks a queued block when the model stays quiet, and an empty mic blip does not drop it', () => {
    const stuck = started()
    delegated(stuck)
    stuck.ingest({ type: 'tts-start', text: '我先看一下', ttsType: 'default' })
    stuck.ingest({ type: 'tts-audio', pcm: Uint8Array.from([1]) })
    const stuckBlock = stuck.queueSummary('结果在这。')
    expect(commitText(stuckBlock)).toBe('结果在这。')
    expect(shows(stuckBlock, '结果在这。')).toBe(true)

    const noise = started()
    delegated(noise)
    expect(noise.ingest({ type: 'asr-info' }).some(command => command.type === 'send')).toBe(false)
    expect(noise.wantsSummary()).toBe(true)
    expect(commitText(noise.ingest({ type: 'asr-ended', text: '' }))).toBeNull()
    expect(commitText(noise.queueSummary('结果在这。'))).toBe('结果在这。')

    const reporting = started()
    delegated(reporting)
    finishHandoff(reporting)
    reporting.queueSummary('第一块。')
    reporting.ingest({ type: 'tts-start', text: '第一块。', ttsType: 'chat_tts_text' })
    reporting.queueSummary('第二块。')
    const idle = reporting.noteIdleWithoutSummary()
    expect(idle.some(command => command.type === 'drop-playback')).toBe(false)
    expect(commitText(idle)).toBeNull()
    expect(commitText(reporting.ingest({ type: 'tts-ended', exitIntent: false }))).toBe('第二块。')
  })

  it('seals an open user line when the tool call arrives before speech ends', () => {
    const call = started()
    call.ingest({ type: 'asr-info' })
    call.ingest({ type: 'asr', text: '打开浏览器，搜索fable 5.2', interim: true })
    const commands = call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{"task":"打开浏览器，搜索fable 5.2"}' }],
    })
    expect(commands.find(command => command.type === 'transcript' && command.phase === 'completed')).toMatchObject({
      role: 'user',
      text: '打开浏览器，搜索fable 5.2',
    })
    expect(commands.find(command => command.type === 'delegate')).toMatchObject({
      transcript: [{ role: 'user', text: '打开浏览器，搜索fable 5.2' }],
    })
  })

  it('does not hand off a paraphrase of the task already sent', () => {
    const call = started()
    call.ingest({ type: 'asr-ended', text: '打开浏览器，搜索fable 5.2' })
    call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{"task":"打开浏览器，搜索fable 5.2"}' }],
    })
    call.ingest({ type: 'tts-start', text: '我这就开始', ttsType: 'default' })
    call.ingest({ type: 'tts-ended', exitIntent: false })
    expect(commitText(call.queueSummary('已经打开了。'))).toBe('已经打开了。')
    const again = call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-2', name: 'delegate_task', arguments: '{"task":"打开浏览器，搜索fable 5.2相关内容"}' }],
    })
    expect(again.some(command => command.type === 'delegate')).toBe(false)
    expect(toolReply(again)).toContain('Already handed')
    expect(call.wantsSummary()).toBe(true)
    expect(commitText(call.noteIdleWithoutSummary())).not.toBe(VOICE_FALLBACK_SPOKEN)
  })

  it('hands the same words off again after the user speaks', () => {
    const call = started()
    call.ingest({ type: 'asr-ended', text: '搜索 fable' })
    call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{"task":"搜索 fable 5.2 的资料"}' }],
    })
    call.ingest({ type: 'asr-ended', text: '再搜一次 fable 5.2' })
    const again = call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-2', name: 'delegate_task', arguments: '{"task":"搜索 fable 5.2 的资料"}' }],
    })
    expect(again.find(command => command.type === 'delegate')).toMatchObject({
      kind: 'turn',
      utterance: '再搜一次 fable 5.2',
      transcript: [{ role: 'user', text: '再搜一次 fable 5.2' }],
    })
  })

  it('does not send a hangup turn, and a resumed call starts again', () => {
    const quiet = started()
    expect(quiet.stop().some(command => command.type === 'delegate')).toBe(false)

    const greeting = started()
    greeting.ingest({ type: 'asr-ended', text: '你好' })
    expect(greeting.stop().some(command => command.type === 'delegate')).toBe(false)

    const call = started()
    call.ingest({ type: 'asr-ended', text: '搜一下' })
    call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{}' }],
    })
    expect(call.stop()).toEqual([{ type: 'send', event: { type: 'session.close' } }])
    expect(call.stop()).toEqual([])

    const resumed = started()
    resumed.ingest({ type: 'asr-ended', text: '再搜一次' })
    const again = resumed.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{}' }],
    })
    expect(again.find(command => command.type === 'delegate')).toMatchObject({
      kind: 'opening',
      utterance: '再搜一次',
    })
  })

  it('does not hand off a rewritten task when the user has not spoken again', () => {
    const call = started()
    call.ingest({ type: 'asr-ended', text: '打开谷歌搜一下 FEEBLE5.2。' })
    call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-1', name: 'delegate_task', arguments: '{"task":"打开谷歌搜索fable 5.2"}' }],
    })
    call.noteIdleWithoutSummary()
    const again = call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-2', name: 'delegate_task', arguments: '{"task":"搜索并整理fable 5.2的相关信息，包括它是什么、核心内容等"}' }],
    })
    expect(again.some(command => command.type === 'delegate')).toBe(false)
    expect(toolReply(again)).toContain('Already handed')
    expect(call.wantsSummary()).toBe(false)
  })

  it('keeps queued prose when another task is delegated before the turn ends', () => {
    const call = started()
    delegated(call)
    const queued = call.queueSummary('活动面板已经打开。')
    expect(shows(queued, '活动面板已经打开。')).toBe(true)
    expect(commitText(queued)).toBe('活动面板已经打开。')
    call.ingest({ type: 'asr-ended', text: '再搜一次新闻' })
    const again = call.ingest({
      type: 'function-calls',
      calls: [{ callId: 'call-2', name: 'delegate_task', arguments: '{"task":"再搜一次新闻"}' }],
    })
    expect(again.find(command => command.type === 'delegate')).toMatchObject({
      continuing: true,
      utterance: '再搜一次新闻',
    })
    expect(call.ingest({ type: 'tts-start', text: '我再看一下', ttsType: 'default' })).toEqual([])
    expect(commitText(call.ingest({ type: 'tts-ended', exitIntent: false }))).toBeNull()
    expect(call.wantsSummary()).toBe(true)
    expect(commitText(call.noteIdleWithoutSummary())).not.toBe(VOICE_FALLBACK_SPOKEN)
  })

  it('speaks the fallback when a delegated turn ends with nothing readable', () => {
    const call = started()
    delegated(call)
    expect(commitText(call.noteIdleWithoutSummary())).toBe(VOICE_FALLBACK_SPOKEN)

    const prose = started()
    delegated(prose)
    expect(commitText(prose.queueSummary('有三个文件。'))).toBe('有三个文件。')
    const settled = prose.noteIdleWithoutSummary()
    expect(commitText(settled)).toBeNull()
    expect(settled.filter(command => command.type === 'send' && command.event.type === 'speech_text_buffer.commit')).toHaveLength(0)
  })

  it('hangs up on idle and exit, and retries a server error once', () => {
    const idle = started()
    expect(idle.ingest({ type: 'error', code: '45000003', message: 'idle', retryable: false })).toEqual([
      { type: 'hangup', reason: 'idle' },
    ])
    const exit = started()
    exit.ingest({ type: 'tts-start', text: '好', ttsType: 'chat_tts_text' })
    expect(exit.ingest({ type: 'tts-ended', statusCode: '20000002', exitIntent: true })).toEqual([
      { type: 'hangup', reason: 'exit' },
    ])
    const retry = started()
    expect(retry.ingest({ type: 'error', code: '50000000', message: 'unavailable', retryable: true })).toEqual([
      { type: 'retry' },
    ])
    expect(retry.ingest({ type: 'error', code: '50000000', message: 'unavailable', retryable: true })).toEqual([
      { type: 'error', message: 'unavailable' },
      { type: 'hangup', reason: 'error' },
    ])
  })

  it('answers a follow-up during a delegated turn, then reads the waiting block', () => {
    const call = started()
    delegated(call)
    finishHandoff(call)
    call.ingest({ type: 'asr-info' })
    call.ingest({ type: 'asr', text: '你在吗', interim: false })
    expect(commitText(call.ingest({ type: 'asr-ended', text: '你在吗' }))).toBeNull()
    const held = call.queueSummary('目录里有三个文件。')
    expect(commitText(held)).toBeNull()
    expect(shows(held, '目录里有三个文件。')).toBe(true)
    const speech = call.ingest({ type: 'tts-start', text: '在的', ttsType: 'default' })
    expect(speech.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([1, 2]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([1, 2]) },
    ])
    expect(shows(call.queueSummary('第二句。'), '第二句。')).toBe(true)
    expect(commitText(call.ingest({ type: 'tts-ended', exitIntent: false }))).toBe('目录里有三个文件。')
  })

  it('plays a reply that starts before the cancelled utterance ends', () => {
    const call = started()
    call.ingest({ type: 'tts-start', text: '我先说完', ttsType: 'default' })
    call.barge()
    const next = call.ingest({ type: 'tts-start', text: '你说', ttsType: 'default' })
    expect(next.some(command => command.type === 'transcript')).toBe(true)
    expect(next.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    expect(call.ingest({ type: 'tts-ended', exitIntent: false })).toEqual([])
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([3]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([3]) },
    ])
    const settled = call.ingest({ type: 'tts-ended', exitIntent: false })
    expect(settled.some(command => command.type === 'transcript' && command.phase === 'completed')).toBe(true)
    expect(settled.some(command => command.type === 'activity' && command.activity === 'listening')).toBe(true)
    expect(settled.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)

    const canceled = started()
    canceled.ingest({ type: 'tts-start', text: '我先说完', ttsType: 'default' })
    canceled.barge()
    canceled.ingest({ type: 'response-canceled' })
    expect(canceled.ingest({ type: 'tts-audio', pcm: Uint8Array.from([1]) })).toEqual([])
    const after = canceled.ingest({ type: 'tts-start', text: '继续', ttsType: 'default' })
    expect(after.some(command => command.type === 'transcript')).toBe(true)
    expect(canceled.ingest({ type: 'tts-audio', pcm: Uint8Array.from([2]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([2]) },
    ])
    expect(canceled.ingest({ type: 'tts-ended', exitIntent: false }).some(command => command.type === 'transcript' && command.phase === 'completed')).toBe(true)

    const exiting = started()
    exiting.ingest({ type: 'tts-start', text: '走了', ttsType: 'default' })
    exiting.barge()
    exiting.ingest({ type: 'tts-start', text: '新的', ttsType: 'default' })
    expect(exiting.ingest({ type: 'tts-ended', exitIntent: true })).toEqual([{ type: 'hangup', reason: 'exit' }])
  })

  it('plays the next reply after a cancelled host commit, before that commit ends', () => {
    const call = started()
    delegated(call)
    expect(commitText(call.queueSummary('改好了'))).toBe('改好了')
    call.ingest({ type: 'asr-info' })
    expect(call.ingest({ type: 'tts-start', text: '改好了', ttsType: 'chat_tts_text' })).toEqual([])
    const reply = call.ingest({ type: 'tts-start', text: '好', ttsType: 'default' })
    expect(reply.some(command => command.type === 'transcript')).toBe(true)
    expect(reply.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    expect(call.ingest({ type: 'tts-ended', exitIntent: false })).toEqual([])
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([4]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([4]) },
    ])
  })

  it('hides a model line during an open watch, then speaks again once the watch ends', () => {
    const call = started()
    delegated(call)
    expect(commitText(call.queueSummary('改好了'))).toBe('改好了')
    call.ingest({ type: 'tts-start', text: '改好了', ttsType: 'chat_tts_text' })
    expect(commitText(call.ingest({ type: 'tts-ended', exitIntent: false }))).toBeNull()
    expect(call.wantsSummary()).toBe(true)
    expect(call.ingest({ type: 'tts-start', text: '我来处理', ttsType: 'default' })).toEqual([])
    call.noteIdleWithoutSummary()
    const reply = call.ingest({ type: 'tts-start', text: '在的', ttsType: 'default' })
    expect(reply.some(command => command.type === 'transcript')).toBe(true)
    expect(reply.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([1]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([1]) },
    ])
  })

  it('lets the next host sentence append after the one still playing', () => {
    const call = started()
    delegated(call)
    expect(commitText(call.queueSummary('我来打开 x.com，并把它放到前台。'))).toBe('我来打开 x.com，并把它放到前台。')
    const first = call.ingest({ type: 'tts-start', text: '我来打开 x.com，并把它放到前台。', ttsType: 'chat_tts_text' })
    expect(first.some(command => command.type === 'drop-playback')).toBe(true)
    call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([1, 2]) })
    expect(commitText(call.queueSummary('手册里确认怎么把网页切到前台。'))).toBeNull()
    const continued = call.ingest({ type: 'tts-start', text: '先确认打开方式。', ttsType: 'chat_tts_text' })
    expect(continued.some(command => command.type === 'drop-playback')).toBe(false)
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([3]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([3]) },
    ])
    expect(commitText(call.ingest({ type: 'tts-ended', exitIntent: false }))).toBe('手册里确认怎么把网页切到前台。')
    const second = call.ingest({ type: 'tts-start', text: '手册里确认怎么把网页切到前台。', ttsType: 'chat_tts_text' })
    expect(second.some(command => command.type === 'drop-playback')).toBe(false)
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([4]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([4]) },
    ])

    const late = started()
    delegated(late)
    late.queueSummary('第一句还没播完。')
    late.ingest({ type: 'tts-start', text: '第一句还没播完。', ttsType: 'chat_tts_text' })
    late.ingest({ type: 'tts-audio', pcm: Uint8Array.from([1, 2, 3, 4]) })
    expect(commitText(late.ingest({ type: 'tts-ended', exitIntent: false }))).toBeNull()
    expect(commitText(late.queueSummary('第二句来了。'))).toBe('第二句来了。')
    const next = late.ingest({ type: 'tts-start', text: '第二句来了。', ttsType: 'chat_tts_text' })
    expect(next.some(command => command.type === 'drop-playback')).toBe(false)
  })

  it('stops playback when the user barges in, then plays the next utterance', () => {
    const quiet = started()
    expect(quiet.barge()).toEqual([])

    const call = started()
    call.ingest({ type: 'tts-start', text: '我先说完', ttsType: 'default' })
    const barge = call.barge()
    expect(barge.some(command => command.type === 'drop-playback')).toBe(true)
    expect(sentTypes(barge)).toContain('response.cancel')
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([1, 2]) })).toEqual([])
    call.ingest({ type: 'tts-ended', exitIntent: false })
    const next = call.ingest({ type: 'tts-start', text: '你说', ttsType: 'default' })
    expect(next.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([3]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([3]) },
    ])

    const reporting = started()
    delegated(reporting)
    finishHandoff(reporting)
    reporting.queueSummary('改好了')
    reporting.ingest({ type: 'tts-start', text: '改好了', ttsType: 'chat_tts_text' })
    expect(reporting.barge().some(command => command.type === 'drop-playback')).toBe(true)
    expect(reporting.wantsSummary()).toBe(false)
    expect(commitText(reporting.ingest({ type: 'tts-ended', exitIntent: false }))).toBeNull()
    expect(commitText(reporting.ingest({ type: 'asr-ended', text: '' }))).toBeNull()
    expect(reporting.queueSummary('下一块。')).toEqual([])
  })

  it('drops audio still queued after the server finished, then plays the new utterance', () => {
    const call = started()
    call.ingest({ type: 'tts-start', text: '第一句已经说完', ttsType: 'default' })
    call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([1, 2]) })
    call.ingest({ type: 'tts-ended', exitIntent: false })
    const heard = call.ingest({ type: 'asr-info' })
    expect(heard.some(command => command.type === 'drop-playback')).toBe(true)
    expect(heard.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    call.ingest({ type: 'asr', text: '停', interim: false })
    expect(commitText(call.ingest({ type: 'asr-ended', text: '停' }))).toBeNull()
    const next = call.ingest({ type: 'tts-start', text: '你说', ttsType: 'default' })
    expect(next.some(command => command.type === 'drop-playback')).toBe(true)
    expect(next.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([3]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([3]) },
    ])
  })

  it('shows a table in the transcript and does not read it or say the fallback', () => {
    const call = started()
    delegated(call)
    const table = '| 名称 | 大小 |\n| --- | --- |\n| a.ts | 12 |'
    const shown = call.queueSummary(table, '')
    expect(shows(shown, table)).toBe(true)
    expect(commitText(shown)).toBeNull()
    const idle = call.noteIdleWithoutSummary()
    expect(commitText(idle)).toBeNull()
    expect(idle.some(command => command.type === 'send' && command.event.type === 'speech_text_buffer.commit')).toBe(false)
  })

  it('shows the full block and reads only the prose', () => {
    const call = started()
    delegated(call)
    const full = '目录里有三个文件。\n\n| 名称 | 大小 |\n| --- | --- |\n| a.ts | 12 |'
    const commands = call.queueSummary(full, '目录里有三个文件。')
    expect(shows(commands, full)).toBe(true)
    expect(commitText(commands)).toBe('目录里有三个文件。')
  })

  it('reads a later block after the user talks in the gap between sentences', () => {
    const call = started()
    delegated(call)
    expect(commitText(call.queueSummary('我来打开百度。'))).toBe('我来打开百度。')
    call.ingest({ type: 'tts-start', text: '我来打开百度。', ttsType: 'chat_tts_text' })
    expect(commitText(call.ingest({ type: 'tts-ended', exitIntent: false }))).toBeNull()
    expect(call.wantsSummary()).toBe(true)
    const heard = call.ingest({ type: 'asr-info' })
    expect(heard.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    expect(call.wantsSummary()).toBe(true)
    call.ingest({ type: 'asr', text: '搜到了什么', interim: false })
    expect(commitText(call.ingest({ type: 'asr-ended', text: '搜到了什么' }))).toBeNull()
    const later = call.queueSummary('百度已经打开，搜的是 GPT 6.2。')
    expect(shows(later, '百度已经打开，搜的是 GPT 6.2。')).toBe(true)
    expect(commitText(later)).toBeNull()
    const reply = call.ingest({ type: 'tts-start', text: '我听到了', ttsType: 'default' })
    expect(reply.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([1]) })
    expect(commitText(call.ingest({ type: 'tts-ended', exitIntent: false }))).toBe('百度已经打开，搜的是 GPT 6.2。')

    const quiet = started()
    delegated(quiet)
    expect(commitText(quiet.queueSummary('第一段。'))).toBe('第一段。')
    quiet.ingest({ type: 'tts-start', text: '第一段。', ttsType: 'chat_tts_text' })
    expect(commitText(quiet.ingest({ type: 'tts-ended', exitIntent: false }))).toBeNull()
    const second = quiet.queueSummary('第二段。')
    expect(shows(second, '第二段。')).toBe(true)
    expect(commitText(second)).toBe('第二段。')
  })

  it('still drops a block already queued when the user talks over the next sentence', () => {
    const call = started()
    delegated(call)
    call.queueSummary('第一段。')
    call.ingest({ type: 'tts-start', text: '第一段。', ttsType: 'chat_tts_text' })
    expect(shows(call.queueSummary('第二段。'), '第二段。')).toBe(true)
    expect(commitText(call.ingest({ type: 'tts-ended', exitIntent: false }))).toBe('第二段。')
    const barge = call.ingest({ type: 'asr-info' })
    expect(sentTypes(barge)).toContain('response.cancel')
    expect(call.wantsSummary()).toBe(false)
    expect(call.queueSummary('第三段。')).toEqual([])
  })

  it('reads a closed block while a wordless mic start is open', () => {
    let now = 0
    const call = clocked(() => now)
    delegated(call)
    call.ingest({ type: 'asr-info' })
    const early = call.queueSummary('正在关掉。')
    expect(shows(early, '正在关掉。')).toBe(true)
    expect(commitText(early)).toBeNull()
    now = 800
    expect(commitText(call.queueSummary('第二句。'))).toBe('正在关掉。')
  })

  it('barges host audio still in the speakers after the server finished', () => {
    let now = 0
    const call = clocked(() => now)
    delegated(call)
    expect(commitText(call.queueSummary('正在关掉当前窗口。'))).toBe('正在关掉当前窗口。')
    call.ingest({ type: 'tts-start', text: '正在关掉当前窗口。', ttsType: 'chat_tts_text' })
    call.ingest({ type: 'tts-audio', pcm: new Uint8Array(24_000 * 2) })
    expect(commitText(call.ingest({ type: 'tts-ended', exitIntent: false }))).toBeNull()
    now = 100
    expect(call.isSpeaking()).toBe(true)
    const barge = call.barge()
    expect(barge.some(command => command.type === 'drop-playback')).toBe(true)
    expect(sentTypes(barge)).not.toContain('response.cancel')
    expect(call.wantsSummary()).toBe(false)
    expect(call.isSpeaking()).toBe(false)
    expect(call.queueSummary('已经关掉了。')).toEqual([])
    const reply = call.ingest({ type: 'tts-start', text: '你说', ttsType: 'default' })
    expect(reply.some(command => command.type === 'transcript')).toBe(true)
    expect(call.ingest({ type: 'tts-audio', pcm: Uint8Array.from([1]) })).toEqual([
      { type: 'play', pcm: Uint8Array.from([1]) },
    ])
    expect(call.ingest({ type: 'tts-ended', exitIntent: false }).some(command => command.type === 'activity' && command.activity === 'listening')).toBe(true)

    let later = 0
    const quiet = clocked(() => later)
    delegated(quiet)
    quiet.queueSummary('第一句。')
    quiet.ingest({ type: 'tts-start', text: '第一句。', ttsType: 'chat_tts_text' })
    quiet.ingest({ type: 'tts-audio', pcm: new Uint8Array(24_000 * 2) })
    quiet.ingest({ type: 'tts-ended', exitIntent: false })
    later = 100
    expect(quiet.isSpeaking()).toBe(true)
    later = 1_000
    expect(quiet.isSpeaking()).toBe(false)
    expect(quiet.barge()).toEqual([])
    expect(quiet.wantsSummary()).toBe(true)
    expect(commitText(quiet.queueSummary('第二句。'))).toBe('第二句。')
    const next = quiet.ingest({ type: 'tts-start', text: '第二句。', ttsType: 'chat_tts_text' })
    expect(next.some(command => command.type === 'drop-playback')).toBe(false)
  })

  it('drops leftover playback but keeps later blocks when speech starts over audio still in the speakers', () => {
    let now = 0
    const call = clocked(() => now)
    delegated(call)
    call.queueSummary('正在关掉。')
    call.ingest({ type: 'tts-start', text: '正在关掉。', ttsType: 'chat_tts_text' })
    call.ingest({ type: 'tts-audio', pcm: new Uint8Array(24_000 * 2) })
    call.ingest({ type: 'tts-ended', exitIntent: false })
    now = 100
    const heard = call.ingest({ type: 'asr-info' })
    expect(heard.some(command => command.type === 'drop-playback')).toBe(true)
    expect(heard.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    expect(call.wantsSummary()).toBe(true)
    now = 900
    expect(commitText(call.queueSummary('已经关掉了。'))).toBe('已经关掉了。')

    let later = 0
    const gap = clocked(() => later)
    delegated(gap)
    gap.queueSummary('第一句。')
    gap.ingest({ type: 'tts-start', text: '第一句。', ttsType: 'chat_tts_text' })
    gap.ingest({ type: 'tts-audio', pcm: new Uint8Array(24_000 * 2) })
    gap.ingest({ type: 'tts-ended', exitIntent: false })
    later = 1_000
    const quiet = gap.ingest({ type: 'asr-info' })
    expect(quiet.some(command => command.type === 'send' && command.event.type === 'response.cancel')).toBe(false)
    expect(gap.wantsSummary()).toBe(true)
    later = 1_800
    expect(commitText(gap.queueSummary('第二句。'))).toBe('第二句。')
  })

  it('gives each call its own transcript item ids', () => {
    const first = started()
    const second = started()
    const left = first.ingest({ type: 'asr-info' }).find(command => command.type === 'transcript')
    const right = second.ingest({ type: 'asr-info' }).find(command => command.type === 'transcript')
    expect(left).toMatchObject({ itemId: expect.stringMatching(/^doubao-.+-user-1$/) })
    expect(right).toMatchObject({ itemId: expect.stringMatching(/^doubao-.+-user-1$/) })
    expect(left?.type === 'transcript' && right?.type === 'transcript' && left.itemId !== right.itemId).toBe(true)
  })

  it('closes the session without another command when the user stops', () => {
    const call = started()
    expect(call.stop()).toEqual([{ type: 'send', event: { type: 'session.close' } }])
  })
})
