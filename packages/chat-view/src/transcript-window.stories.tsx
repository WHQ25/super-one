import { useEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage, Locale } from '@superone/shared/agent-types'
import { DEFAULT_WINDOW_BUDGET, selectTranscriptWindow } from '@superone/shared/transcript-window/select-window'
import { applyWindowResult, EMPTY_WINDOW_LOOKUP, materializeWindowMessage, type TranscriptWindowState } from '@superone/shared/transcript-window/window-store'
import { longReplyText, textMessage, windowSource } from '@superone/shared/transcript-window/window-fixtures'
import { MAX_FRAGMENT_BYTES } from '@superone/shared/transcript-window/fragment-message'
import { ChatView } from './ChatView'
import type { TranscriptWindowPage } from './protocol'

type Content = 'prose' | 'fence' | 'table' | 'omitted'
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

function TranscriptWindowPreview({ content = 'prose', native = 'ready', scheme = 'light', locale = 'en', width = 430 }: {
  content?: Content; native?: Native; scheme?: 'light' | 'dark'; locale?: Locale; width?: number
}) {
  useEffect(() => {
    const host = globalThis as typeof globalThis & { ReactNativeWebView?: { postMessage(raw: string): void }; __applyHost?: (value: unknown) => void }
    const previous = host.ReactNativeWebView
    const transcript = [textMessage('ask', 'user', 'Show me everything.'), reply(content)]
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
      } else if (request.action === 'loadFullMessage') {
        if (native === 'copy-loading') return
        answer({ result: { message: transcript.find((m) => m.id === request.payload.messageId) } })
      } else answer({ result: {} })
    } }
    host.__applyHost?.({ type: 'setTheme', scheme })
    host.__applyHost?.({ type: 'setViewport', locale })
    host.__applyHost?.({ type: 'hydrate', transcriptWindow: true, hasMoreHistory: window.older !== null, sessionStatus: 'idle',
      messages: window.messages.map(materializeWindowMessage) })
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
