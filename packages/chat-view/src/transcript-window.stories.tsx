import { useEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage, Locale } from '@superone/shared/agent-types'
import { DEFAULT_WINDOW_BUDGET, selectTranscriptWindow } from '@superone/shared/transcript-window/select-window'
import { applyWindowResult, EMPTY_WINDOW_LOOKUP, materializeWindowMessage, type TranscriptWindowState } from '@superone/shared/transcript-window/window-store'
import { longReplyText, processTurn, textMessage, windowSource } from '@superone/shared/transcript-window/window-fixtures'
import { MAX_FRAGMENT_BYTES, MessageFragmenter } from '@superone/shared/transcript-window/fragment-message'
import { foldMessageFragments, selectFoldPage } from '@superone/shared/transcript-window/folds'
import { TranscriptWindowSync } from '@superone/shared/transcript-window/window-sync'
import { planProcessFolds } from '@superone/chat-core/turn-process/process-folds'
import { ChatView } from './ChatView'
import { collapsedHistoryTranscript } from './fixtures/collapsed-history'
import type { TranscriptWindowPage } from './protocol'

type Content = 'prose' | 'fence' | 'table' | 'omitted' | 'collapsed' | 'folded'
type Native = 'ready' | 'loading' | 'error' | 'copy-loading'

const BUDGET = { ...DEFAULT_WINDOW_BUDGET, maxBytes: 48 * 1024, targetChars: 3000 }

function reply(content: Content): ChatMessage {
  if (content === 'fence') {
    const code = Array.from({ length: 900 }, (_, i) => `export const value${i} = compute(${i}) // generated line ${i}`).join('\n')
    return textMessage('reply', 'assistant', `Here is the generated module:\n\n\`\`\`ts\n${code}\n\`\`\`\n\nThat is the whole file.`)
  }
  if (content === 'table') {
    const rows = Array.from({ length: 700 }, (_, i) => `| case ${i} | ${i % 3 ? 'pass' : 'fail'} | ${i * 7} ms |`).join('\n')
    return textMessage('reply', 'assistant', `Benchmark results:\n\n| Case | Result | Time |\n| --- | --- | --- |\n${rows}\n\nAll cases ran.`)
  }
  if (content === 'omitted') {
    return { ...textMessage('reply', 'assistant', 'The command printed more than a phone can show:'), content: [
      { type: 'text', text: 'The command printed more than a phone can show:' },
      { type: 'tool_result', toolUseId: 'big', summary: 'x'.repeat(MAX_FRAGMENT_BYTES + 1) },
      { type: 'text', text: 'Everything else is summarized above.' },
    ] }
  }
  return textMessage('reply', 'assistant', longReplyText(160 * 1024))
}

/** The phone's host for a settled turn of `tools` calls: process folded, pages read on demand. */
function foldingHost(tools: number) {
  const transcript = [textMessage('ask', 'user', 'Refactor the project.'), processTurn('reply', tools)]
  const fragmenter = new MessageFragmenter()
  const plans = new Map(transcript.map((message) => [message.id, planProcessFolds(message)]))
  const folded = (message: ChatMessage) => foldMessageFragments(fragmenter.fragment(message), plans.get(message.id)!.ranges)
  const source = { count: transcript.length, at: (index: number) => folded(transcript[index]), indexOf: (id: string) => transcript.findIndex((m) => m.id === id) }
  const sync = new TranscriptWindowSync(applyWindowResult(null, { ...selectTranscriptWindow(source, {}, BUDGET), total: transcript.length }, EMPTY_WINDOW_LOOKUP).state)
  return {
    sync,
    /** One page past what the view holds, joined: the rows that changed. */
    page(messageId: string, key: string): ChatMessage[] {
      const request = sync.foldRequest(messageId, key)
      const index = source.indexOf(messageId)
      const inner = request && index >= 0 ? source.at(index).folds.get(key) : undefined
      const range = inner && selectFoldPage(inner, request!.after, { ...BUDGET, maxFragments: 24 })
      if (!request || !inner || !range) throw new Error('History changed')
      const rest = range.end < inner.entries.length
        ? { ...plans.get(messageId)!.summarize(inner.blocks[range.end], inner.blocks[inner.blocks.length - 1]), fragments: inner.entries.length - range.end }
        : null
      sync.applyFoldPage({ sessionId: 's', messageId, fold: key, revision: request.revision,
        fragments: inner.entries.slice(range.start, range.end).map(({ key, digest, body }) => ({ key, digest, body })), rest }, request.after)
      return sync.messages().filter((message) => message.id === messageId)
    },
  }
}

function TranscriptWindowPreview({ content = 'prose', native = 'ready', scheme = 'light', locale = 'en', width = 430 }: {
  content?: Content; native?: Native; scheme?: 'light' | 'dark'; locale?: Locale; width?: number
}) {
  useEffect(() => {
    const host = globalThis as typeof globalThis & { ReactNativeWebView?: { postMessage(raw: string): void }; __applyHost?: (value: unknown) => void }
    const previous = host.ReactNativeWebView
    const folds = content === 'folded' ? foldingHost(240) : null
    const transcript = content === 'collapsed' ? collapsedHistoryTranscript()
      : [textMessage('ask', 'user', 'Show me everything.'), reply(content)]
    const source = windowSource(transcript)
    let window: TranscriptWindowState = applyWindowResult(null, { ...selectTranscriptWindow(source, {}, BUDGET), total: transcript.length }, EMPTY_WINDOW_LOOKUP).state
    let failed = false
    const page = (): TranscriptWindowPage => ({
      messages: window.messages.map(materializeWindowMessage), messageOrder: window.messages.map((m) => m.id),
      replace: false, hasMoreHistory: window.older !== null, hasNewerHistory: false,
    })
    host.__applyHost?.({ type: 'channelToken', token: 'storybook' })
    host.ReactNativeWebView = { postMessage(raw) {
      const request = JSON.parse(raw)
      if (request.type !== 'requestNative') return
      const answer = (value: { result?: unknown; error?: string }) => queueMicrotask(() => host.__applyHost?.({ type: 'nativeActionResult', requestId: request.requestId, ...value }))
      if (request.action === 'loadEarlier') {
        if (native === 'loading') return
        if (native === 'error' && !failed) { failed = true; answer({ error: 'Temporary history failure' }); return }
        window = applyWindowResult(window, { ...selectTranscriptWindow(source, { anchor: window.older!, direction: 'before' }, BUDGET), total: transcript.length }, EMPTY_WINDOW_LOOKUP, 'older').state
        answer({ result: page() })
      } else if (request.action === 'loadTranscriptFold' && folds) {
        if (native === 'loading') return
        if (native === 'error' && !failed) { failed = true; answer({ error: 'Temporary history failure' }); return }
        const rows = folds.page(request.payload.messageId, request.payload.fold)
        // The phone's paint carries the joined row; the read itself only settles.
        setTimeout(() => {
          host.__applyHost?.({ type: 'applyReductionPatch', messagePatches: rows })
          answer({ result: { ok: true } })
        }, 300)
      } else if (request.action === 'loadFullMessage') {
        if (native === 'copy-loading') return
        answer({ result: { message: transcript.find((m) => m.id === request.payload.messageId) } })
      } else answer({ result: {} })
    } }
    host.__applyHost?.({ type: 'setTheme', scheme })
    host.__applyHost?.({ type: 'setViewport', locale })
    host.__applyHost?.({ type: 'hydrate', transcriptWindow: true, hasMoreHistory: !folds && window.older !== null, sessionStatus: 'idle',
      messages: folds ? folds.sync.messages() : window.messages.map(materializeWindowMessage) })
    return () => { host.ReactNativeWebView = previous }
  }, [content, native, scheme, locale])
  return <div className="mx-auto" style={{ maxWidth: width }}><ChatView /></div>
}

const meta = { title: 'Chat/Mobile transcript window', component: TranscriptWindowPreview,
  render: (args, context) => <TranscriptWindowPreview {...args} scheme={context.globals.theme ?? 'light'} locale={context.globals.locale ?? 'en'} />,
  parameters: { layout: 'fullscreen' } } satisfies Meta<typeof TranscriptWindowPreview>
export default meta
type Story = StoryObj<typeof meta>

/** The tail of a long reply; scrolling up loads its earlier part into the same message. */
export const PartialReply: Story = {}
/** A short tail automatically pages past folded process until the viewport fills. */
export const AutomaticFirstScreen: Story = { args: { content: 'collapsed' } }
export const AutomaticFirstScreenLoading: Story = { args: { content: 'collapsed', native: 'loading' } }
export const AutomaticFirstScreenRetry: Story = { args: { content: 'collapsed', native: 'error' } }
/** A slice that starts inside a code fence renders as code, not prose. */
export const ContinuedCodeFence: Story = { args: { content: 'fence' } }
/** A slice that starts inside a table repeats the header rows. */
export const ContinuedTable: Story = { args: { content: 'table' } }
/** A block too large for one fragment stands in as a notice. */
export const OmittedBlock: Story = { args: { content: 'omitted' } }
export const EarlierPartLoading: Story = { args: { native: 'loading' } }
export const EarlierPartRetry: Story = { args: { native: 'error' } }
/** Copying a partial reply fetches the whole message first; this host never answers. */
export const CopyWhileFetching: Story = { args: { native: 'copy-loading' } }
export const Narrow: Story = { args: { width: 320 } }
/**
 * A settled turn of 240 calls arrives as its reply and a Detail header with
 * the real counts. Opening Detail reads the first page of calls; scrolling
 * down reads the next one as the end comes near.
 */
export const FoldedProcess: Story = { args: { content: 'folded' } }
/** Detail opened on a host that has not answered yet. */
export const FoldedProcessLoading: Story = { args: { content: 'folded', native: 'loading' } }
/** The first page fails; Retry reads it again. */
export const FoldedProcessRetry: Story = { args: { content: 'folded', native: 'error' } }
export const FoldedProcessNarrow: Story = { args: { content: 'folded', width: 320 } }
