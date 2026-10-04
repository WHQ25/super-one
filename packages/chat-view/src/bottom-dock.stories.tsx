import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo, type ReactNode } from 'react'
import type { AskUserQuestionRequest } from '@superone/shared/agent-types'
import type { ModChild, ModElement, ModPaneRoster, ModUiOp } from '@superone/shared/mod-ui'
import { BottomDock } from './BottomDock'
import { PortableCommandOutput, PortableQuestion } from './PortableDecisionCards'
import { ModUiClient, type ModUiTransport } from './mod-ui/client'
import { MobileModPanes, MobileModUiProvider } from './mod-ui/MobileModUi'

const choice = {
  header: 'Layout', question: 'Which layout should we use?', multiSelect: false,
  options: [
    { label: 'Compact', description: 'Keep the conversation visible above the input.' },
    { label: 'Comfortable', description: 'Use more spacing between controls for easier reading.' },
  ],
}

const QUESTIONS: Record<string, AskUserQuestionRequest> = {
  single: { requestId: 'q-single', questions: [choice] },
  multiple: {
    requestId: 'q-multiple',
    questions: [choice, {
      header: 'Platforms', question: 'Which platforms should be checked? / 检查哪些平台？', multiSelect: true,
      options: [{ label: 'iOS', description: 'Phone and tablet safe areas.' }, { label: 'Android', description: 'Back button and keyboard behavior.' }],
    }],
  },
  markdown: {
    requestId: 'q-markdown', previewFormat: 'markdown',
    questions: [{ ...choice, options: choice.options.map((o) => ({ ...o, preview: `### ${o.label}\n\n${o.description}\n\n- Add a note to explain your preference.` })) }],
  },
  html: {
    requestId: 'q-html', previewFormat: 'html',
    // Written for a white page, as models do; the script must not run.
    questions: [{ ...choice, options: choice.options.map((o) => ({ ...o, preview: `<div style="width:320px;font-family:system-ui;border:1px solid #cbd5e1;border-radius:8px;background:#fff"><div style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-weight:600">${o.label}</div><div style="padding:14px;color:#334155">${o.description}</div></div><script>document.body.innerHTML='script ran'</script>` })) }],
  },
  long: {
    requestId: 'q-long',
    questions: [{
      header: 'Migration', multiSelect: false,
      question: 'The relay keeps per-device acknowledgements, and the desktop replays unacknowledged events after a reconnect. Should the phone drop the cached transcript when the epoch changes, or keep it and reconcile by message id?',
      options: [
        { label: 'Drop and rehydrate from the desktop on every epoch change', description: 'Simplest; costs a full transcript transfer after each reconnect.' },
        { label: 'Keep and reconcile by message id', description: 'Faster reconnects; needs a merge that tolerates reordered patches.' },
        { label: 'Keep only the visible window', description: 'Bounded memory; older turns reload on scroll.' },
      ],
    }],
  },
}

const OUTPUT = { command: 'context', content: 'Context Usage\n  claude-opus-5-5 · 48k/200k tokens (24%)\n\n  System prompt      3.1k\n  System tools      11.8k\n  MCP tools          6.4k\n  Messages          26.7k\n  Free space       152.0k' }

const T = (text: string, props: Record<string, string | boolean> = {}): ModElement => ({ type: 'Text', props, children: [text] })
const Row = (...children: ModChild[]): ModElement => ({ type: 'Box', props: { flexDirection: 'row', gap: 1, flexWrap: 'wrap' }, children })
let handle = 0
const Button = (key: string, label: string, extra: Record<string, unknown> = {}): ModElement =>
  ({ type: 'Button', props: { key, label, ...extra }, press: { plugin: 'blast-radius', handle: ++handle } }) as ModElement

/** Blast Radius as the CLI sends it to a phone, plus every other kind of button a mod can draw. */
const BLAST_RADIUS: ModElement = {
  type: 'Box',
  props: { flexDirection: 'column', borderStyle: 'round', borderColor: 'warning', paddingX: 1 },
  children: [
    T('⚠ Blast Radius · rm -rf', { bold: true, color: 'warning' }),
    Row(T('Command', { dimColor: true }), T('rm -rf build', { bold: true })),
    Row(T('Would  ', { dimColor: true }), T('delete 3 files (about 0 B)', { color: 'error' })),
    T('  build/c.txt\n  build/b.txt\n  build/a.txt'),
    Row(Button('proceed', 'Proceed', { hotkey: '1', plain: true }), Button('cancel', 'Cancel', { hotkey: '2', plain: true }), T('Claude is waiting on your answer', { dimColor: true })),
    Row(Button('deploy', 'Deploy', { variant: 'primary', hotkey: 'd' }), Button('retry', 'Retry e2e', { variant: 'secondary' }), Button('dim', 'Later', { dimColor: true }), Button('close', 'Close', { role: 'dismiss' })),
  ],
}

const PANES: ModPaneRoster = { panes: [{ id: 'blast-radius', title: 'Blast Radius', plugin: 'blast-radius' }], shownId: 'blast-radius', focusedId: null, focusRequestedId: null }

/** A phone's mod client against a fake CLI: the pane draws BLAST_RADIUS; presses are logged. */
function storyModClient(): ModUiClient {
  const transport = (async (op: ModUiOp, request: unknown) => {
    if (op === 'panes') return PANES
    if (op === 'render') return { tree: BLAST_RADIUS, props: {}, hooked: true }
    if (op !== 'attach') console.info('[mod story]', op, request)
    return { handled: true }
  }) as unknown as ModUiTransport
  return new ModUiClient({ transport, surface: 'mobile', clientId: 'storybook' })
}

function ModSession({ scheme, children }: { scheme: 'light' | 'dark'; children: ReactNode }) {
  const client = useMemo(storyModClient, [])
  useEffect(() => {
    void client.attach()
    return () => client.dispose()
  }, [client])
  return <MobileModUiProvider client={client} scheme={scheme}>{children}</MobileModUiProvider>
}

/**
 * A phone-sized document: the transform makes it the containing block for the
 * dock's `position: fixed`, so it pins to this frame's bottom as it pins to the
 * WebView's (the native composer's top) on the phone.
 */
function PhoneDocument({ question, output, modPane, width, scheme }: {
  question?: keyof typeof QUESTIONS
  output?: boolean
  modPane?: boolean
  width: number
  scheme: 'light' | 'dark'
}) {
  const document = (
    <div className="relative overflow-hidden rounded-xl border border-border bg-background text-foreground [transform:translateZ(0)]" style={{ width, height: 700 }}>
      <div className="space-y-3 p-4 text-sm text-muted-foreground">
        <p>…the transcript scrolls under the dock; its padding keeps the last turn clear of it.</p>
      </div>
      <BottomDock>
        {modPane && <MobileModPanes />}
        {output && <PortableCommandOutput output={OUTPUT} />}
        {question && <PortableQuestion request={QUESTIONS[question]} scheme={scheme} />}
      </BottomDock>
    </div>
  )
  return modPane ? <ModSession scheme={scheme}>{document}</ModSession> : document
}

const meta = {
  title: 'Chat/Mobile bottom dock',
  component: PhoneDocument,
  parameters: { layout: 'centered' },
  args: { width: 390, scheme: 'light' },
  render: (args, context) => <PhoneDocument {...args} scheme={context.globals.theme === 'dark' ? 'dark' : 'light'} />,
} satisfies Meta<typeof PhoneDocument>

export default meta
type Story = StoryObj<typeof meta>

export const QuestionSingle: Story = { args: { question: 'single' } }
export const QuestionMultiple: Story = { args: { question: 'multiple' } }
export const QuestionMarkdownPreview: Story = { args: { question: 'markdown' } }
/** The option's HTML draws in a frame with no script and no origin: the `<script>` must not run. */
export const QuestionHtmlPreview: Story = { args: { question: 'html' } }
export const QuestionLongNarrow: Story = { args: { question: 'long', width: 320 } }
export const CommandOutput: Story = { args: { output: true } }
export const OutputAndQuestion: Story = { args: { output: true, question: 'single' } }
export const Empty: Story = { args: {} }
/** A mod pane's buttons on the phone: finger-sized and bordered, no hotkey caps. */
export const ModPaneButtons: Story = { args: { modPane: true } }
export const ModPaneButtonsNarrow: Story = { args: { modPane: true, width: 320 } }
