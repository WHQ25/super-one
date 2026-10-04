import type { Meta, StoryObj } from '@storybook/react-vite'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ModCommandOutputSite, ModQuestionSite, ModSite, ModSurfaceFrame, ModUiClient, ModUiProvider, commandOutputProps, sessionModeProps, spinnerProps, userMessageProps, stringProp, type ModUiTransport } from '@superone/chat-view/mod-ui'
import { AskUserQuestionForm } from '@superone/chat-view/presenters/AskUserQuestionForm'
import type { AgentEvent, AskUserQuestionRequest, ChatMessage } from '@superone/shared/agent-types'
import { EMPTY_MOD_PANE_ROSTER, MOD_ABOVE_PROMPT_INSTANCE, MOD_SESSION_MODE_INSTANCE, type ModChild, type ModClientModuleBundle, type ModElement, type ModPaneRoster, type ModRenderResult, type ModUiOp } from '@superone/shared/mod-ui'
import { desktopModUiPorts } from '@/lib/mod-ui/DesktopModUi'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { UserTextBlock } from '../ChatMessage'
import { DurationFooter } from '../ChatMessageFooter'
import { ModAbovePrompt, ModPaneBody } from './ModSurfaces'
import { ModSessionMode } from './ModStatusSites'

/**
 * What SuperOne draws for Claude Code mods, against a fake session: each story
 * answers `ui_render` from a fixture, so nothing reaches a CLI. Presses are
 * logged to the console and redraw the same tree.
 */

const T = (text: string, props: Record<string, string | number | boolean> = {}): ModElement => ({ type: 'Text', props, children: [text] })
const Row = (...children: ModChild[]): ModElement => ({ type: 'Box', props: { flexDirection: 'row', gap: 1 }, children })
const Col = (...children: ModChild[]): ModElement => ({ type: 'Box', props: { flexDirection: 'column', gap: 1 }, children })
let handle = 0
const press = () => ({ plugin: 'story-mod', handle: ++handle })
const Button = (key: string, label: string, extra: Record<string, unknown> = {}): ModElement => ({ type: 'Button', props: { key, label, ...extra }, press: press() } as ModElement)

const CLIENT: ModElement = { type: 'Client', props: { key: 'board', module: 'hooks/board.mjs', props: { label: 'hi' }, height: 2 }, client: { plugin: 'story-mod' } }

const PROBE_PANE = Col(
  T('probe pane surface=desktop placement=dock count=2', { bold: true, color: 'green' }),
  Row(Button('go', 'Go', { hotkey: 'g', variant: 'primary' }), Button('later', 'Later', { hotkey: 'l' }), Button('dismiss', 'Close', { role: 'dismiss' })),
  { type: 'Markdown', props: { key: 'md', text: 'See [docs](https://example.com/a) and **bold**' } },
  { type: 'Code', props: { source: '@@ -1,2 +1,2 @@\n-a\n+b\n c', format: 'diff' } },
  { type: 'Code', props: { source: 'const answer = 42\nconsole.log(answer)', language: 'ts' } },
  { type: 'Link', props: { href: 'https://example.com', label: 'example' } },
  { type: 'Input', props: { key: 'name', label: 'Name', placeholder: 'type', submitLabel: 'add' }, press: press() },
  { type: 'Select', props: { key: 'size', label: 'Size', options: [{ value: 'sm', label: 'Small' }, { value: 'lg', label: 'Large' }], value: 'sm' }, press: press() },
  { type: 'Svg', props: { alt: 'bar', width: 20, height: 2, source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 2"><rect width="10" height="2" fill="#2e7d32"/></svg>' } },
  CLIENT,
)

/**
 * A stand-in for the CLI's surface runtime with the same contract
 * (`install(host, limits)`, `stage` + `__surface__.run()`, `held` handles),
 * enough to run the board below in the real sandboxed frame.
 */
const FAKE_RUNTIME = `
export const h = (type, props, ...children) => ({ type, props: props ?? {}, children })
export const Fragment = (props) => ({ type: 'Box', props: { flexDirection: 'column' }, children: props.children ?? [] })
export const install = (host) => {
  let pending = null
  const instances = new Map()
  globalThis.__surface__ = { run: () => { const p = pending; pending = null; return p ? p() : undefined } }
  const el = (type) => (props = {}) => { const { children, onPress, ...rest } = props; return { type, props: rest, onPress, children: children === undefined ? undefined : [].concat(children) } }
  const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button') }
  const exportTree = (i, node) => {
    const walk = (n) => typeof n === 'string' ? n
      : n.type === 'Button' ? (i.held.set(++i.handles, n.onPress), { type: 'Button', props: n.props, held: i.handles })
      : { type: n.type, props: n.props, ...(n.children ? { children: n.children.map(walk) } : {}) }
    return JSON.stringify(walk(node))
  }
  return {
    mount(id, fn, props) {
      const i = { fn, props, state: undefined, held: new Map(), handles: 0, timers: new Map() }
      i.surface = {
        elements,
        get state() { return i.state },
        setState(next) { i.state = next; host.schedule(id) },
        every(ms, f) { i.timers.set(host.startTimer(id, ms), f) },
        onPointer() {}, onKey() {},
        post(data) { host.post(id, JSON.stringify(data)) },
      }
      instances.set(id, i)
    },
    setProps(id, props) { instances.get(id).props = props },
    resize() {},
    dropHeld(id, handles) { for (const h of handles) instances.get(id).held.delete(h) },
    hasListener: () => false,
    stage(id, kind, payload) {
      const i = instances.get(id)
      pending = () => kind === 'render' ? exportTree(i, i.fn(i.props, i.surface))
        : kind === 'tick' ? void i.timers.get(payload)?.()
        : kind === 'held' ? void i.held.get(payload.handle)?.(payload.event)
        : undefined
    },
  }
}`

const BOARD = `export default function Board(props, surface) {
  const { Box, Text, Button } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ ticks: 0 })
    surface.every(500, () => surface.setState({ ticks: surface.state.ticks + 1 }))
  }
  return Box({ flexDirection: 'column', children: [
    Text({ children: ['client ticks ' + surface.state.ticks + ' label=' + props.label] }),
    Button({ key: 'client-btn', label: 'client press', onPress: () => surface.post({ pressed: true }) }),
  ] })
}`

const FAULTY_BOARD = `export default function Board() { throw new Error('board exploded') }`

function clientBundle(source: string): ModClientModuleBundle {
  return {
    plugin: 'story-mod',
    hash: String(source.length),
    modules: [{ module: 'hooks/board.mjs', entry: 'surface:///hooks/board.mjs', component: 'default' }],
    runtime: 'claude:surface-runtime',
    limits: { nodes: 20000, depth: 32, chars: 100000, values: 20000, dataDepth: 32 },
    files: [{ key: 'claude:surface-runtime', source: FAKE_RUNTIME }, { key: 'surface:///hooks/board.mjs', source }],
  }
}

const CLIENT_PANE = Col(T('A Client part the plugin draws itself:', { dimColor: true }), CLIENT)

const BLAST_RADIUS = {
  type: 'Box',
  props: { flexDirection: 'column', borderStyle: 'round', borderColor: 'warning', paddingX: 1 },
  children: [
    T('⚠ Blast Radius · rm -rf', { bold: true, color: 'warning' }),
    Row(T('Command', { dimColor: true }), T('rm -rf build', { bold: true })),
    Row(T('Would   ', { dimColor: true }), T('delete 4 files (about 16 KB)', { color: 'error' })),
    T('  build/a1.txt\n  build/a2.txt\n  build/a3.txt\n  build/sub/b.txt'),
    Row(Button('proceed', 'Proceed', { hotkey: '1', plain: true }), Button('cancel', 'Cancel', { hotkey: '2', plain: true, autoFocus: true }), T('Claude is waiting on your answer', { dimColor: true })),
  ],
} as ModElement

const TOKEN_WEATHER = Row(T('☂  Showers', { bold: true, color: 'warning' }), T('67% of context'), T('134.4k / 200k', { dimColor: true }), T('last turns ▁▂█', { dimColor: true }), T('▲ +98.3k last turn', { color: 'error' }))

const LONG_PANE = Col(...Array.from({ length: 60 }, (_, i) => T(`line ${i + 1} — ${'a long row that wraps in a narrow pane '.repeat(i % 3 === 0 ? 3 : 1)}`)), { type: 'Box', props: { key: 'bottom' }, children: [T('bottom row', { dimColor: true })] })

type Answer = ModRenderResult | 'pending' | 'fail'

function storyClient(answers: Record<string, Answer>, roster?: ModPaneRoster, board = BOARD): ModUiClient {
  // Showing and closing panes answer like the CLI: a new roster pushed to the client.
  let panes = roster ?? EMPTY_MOD_PANE_ROSTER
  const push = (next: ModPaneRoster) => {
    panes = next
    client.handleEvent({ type: 'mod_panes', roster: next } as AgentEvent)
  }
  const transport = (async (op: ModUiOp, request: { component?: string; instanceId?: string; id?: string }) => {
    if (op === 'attach') return { surfaces: ['desktop'] }
    if (op === 'panes') return panes
    if (op === 'paneShow' && request.id) {
      push({ ...panes, shownId: request.id })
      return { shownId: request.id }
    }
    if (op === 'close' && request.id) {
      const rest = panes.panes.filter((p) => p.id !== request.id)
      push({ ...panes, panes: rest, shownId: panes.shownId === request.id ? (rest.at(-1)?.id ?? null) : panes.shownId })
      return { closed: true }
    }
    if (op === 'render') {
      const answer = answers[`${request.component}:${request.instanceId}`] ?? answers[request.component ?? '']
      if (answer === 'pending') return new Promise(() => {})
      if (answer === 'fail') throw new Error('mod-ui-unavailable')
      return answer ?? { tree: { type: 'engine', ref: 0 }, props: {}, hooked: false }
    }
    if (op === 'clientModule') return clientBundle(board)
    if (op === 'clientPress') return { handled: true, reached: {} }
    if (op === 'message') {
      console.info('[mod story] message', request)
      return { handled: true, props: { label: 'after-message' } }
    }
    console.info('[mod story]', op, request)
    return { handled: true }
  }) as unknown as ModUiTransport
  const client = new ModUiClient({ transport, surface: 'desktop', clientId: 'storybook' })
  return client
}

const drawn = (tree: ModElement, props: Record<string, unknown> = {}): ModRenderResult => ({ tree, props, hooked: true })

function Session({ answers, roster, off, board, children }: { answers: Record<string, Answer>; roster?: ModPaneRoster; off?: boolean; board?: string; children: ReactNode }) {
  const client = useMemo(() => storyClient(answers, roster, board), [answers, roster, board])
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (off) {
      setReady(true)
      return
    }
    void client.attach().then(() => setReady(true))
    return () => client.dispose()
  }, [client, off])
  if (!ready) return null
  return <ModUiProvider client={off ? null : client} ports={desktopModUiPorts}>{children}</ModUiProvider>
}

function PaneFrame({ tree, width = 560, height = 420, board }: { tree: Answer; width?: number; height?: number; board?: string }) {
  const answers = useMemo(() => ({ Pane: tree }), [tree])
  const props = useMemo(() => ({ title: 'Probe pane', placement: 'dock', view: {} }), [])
  return (
    <Session answers={answers} board={board}>
      <div className="flex flex-col rounded-lg border border-border bg-background p-3" style={{ width, height, maxWidth: '100%' }}>
        <ModSurfaceFrame component="Pane" instanceId="probe" plugin="story-mod" props={props} className="flex-1" />
      </div>
    </Session>
  )
}

function Band({ tree }: { tree: Answer }) {
  const answers = useMemo(() => ({ AbovePrompt: tree }), [tree])
  const props = useMemo(() => ({ hasSurvey: false, isWorking: false, maxRows: 8, view: {} }), [])
  return (
    <Session answers={answers}>
      <div className="w-[640px] max-w-full rounded-xl border border-border bg-background p-2">
        <ModSurfaceFrame component="AbovePrompt" instanceId={MOD_ABOVE_PROMPT_INSTANCE} props={props} className="max-h-[calc(8*var(--mod-row,18px))] rounded-lg px-1" />
        <div className="mt-1 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">Ask Claude anything…</div>
      </div>
    </Session>
  )
}

function UserRow({ answer, off }: { answer: Answer; off?: boolean }) {
  const text = 'Rename the helper and update its callers'
  const answers = useMemo(() => ({ UserMessage: answer }), [answer])
  const props = useMemo(() => userMessageProps(text), [])
  return (
    <Session answers={answers} off={off}>
      <div className="w-[520px] max-w-full rounded-2xl bg-muted px-4 py-2 text-sm">
        <ModSite component="UserMessage" instanceId="m1" props={props}>
          {(p) => <UserTextBlock text={stringProp(p, 'text', text)} />}
        </ModSite>
      </div>
    </Session>
  )
}

const QUESTION: AskUserQuestionRequest = {
  requestId: 'q-story',
  questions: [{
    header: 'Library', question: 'Which date library?', multiSelect: false,
    options: [{ label: 'date-fns', description: 'Immutable helpers' }, { label: 'dayjs', description: 'Smaller bundle' }],
  }],
}

const QUESTION_WRAP = Col(T('⚑ probe: this answer is logged', { color: 'cyan', dimColor: true }), { type: 'engine', ref: 1 })

/** The question with a mod around it: with the desktop's keyboard, or as the phone draws it (touch). */
function QuestionCard({ answer, touch }: { answer: Answer; touch?: boolean }) {
  const answers = useMemo(() => ({ AskUserQuestion: answer }), [answer])
  const log = (...args: unknown[]) => console.info('[mod story] question', ...args)
  return (
    <Session answers={answers}>
      <div style={{ width: touch ? 390 : 640, maxWidth: '100%' }}>
        <ModQuestionSite request={QUESTION}>
          <AskUserQuestionForm request={QUESTION} onSubmit={log} onDismiss={() => log('dismiss')}
            renderPreview={({ content }) => <pre>{content}</pre>} keyboard={touch ? undefined : { inScope: () => false }} />
        </ModQuestionSite>
      </div>
    </Session>
  )
}

const COMMAND_OUTPUT = 'Total cost: $0.42\nTotal duration (API): 1m 12s'

function CommandOutputCard({ answer }: { answer: Answer }) {
  const answers = useMemo(() => ({ CommandOutput: answer }), [answer])
  return (
    <Session answers={answers}>
      <div className="w-[520px] max-w-full rounded-xl border border-border bg-popover px-3 py-2">
        <ModCommandOutputSite command="cost" content={COMMAND_OUTPUT}>
          {(text) => <pre className="whitespace-pre-wrap text-xs">{text}</pre>}
        </ModCommandOutputSite>
      </div>
    </Session>
  )
}

const PANES: ModPaneRoster = {
  panes: [
    { id: 'blast', title: 'Blast Radius', plugin: 'blast-radius' },
    { id: 'probe', title: 'Probe', plugin: 'story-mod', rows: 6 },
  ],
  shownId: 'probe',
  focusedId: null,
  focusRequestedId: null,
}

const ONE_PANE: ModPaneRoster = { ...PANES, panes: [{ id: 'tall', title: 'A pane with a long title that has to truncate somewhere', plugin: 'an-exceptionally-long-plugin-name' }], shownId: 'tall' }

/**
 * The composer as ChatInput lays it out: the mod band and inline panes above
 * it, SessionMode in its toolbar. The dock is hidden, so panes draw inline.
 * Type into the box, or with it empty press 1 / 2 for the band's buttons;
 * Ctrl+X Tab moves into the pane and back.
 */
function Composer({ answers, roster, width = 640 }: { answers: Record<string, Answer>; roster?: ModPaneRoster; width?: number }) {
  useLayoutEffect(() => {
    const shown = useActivityPanelStore.getState().showPanel
    useActivityPanelStore.setState({ showPanel: false })
    return () => {
      useActivityPanelStore.setState({ showPanel: shown })
    }
  }, [])
  const editor = useRef<HTMLDivElement>(null)
  const isEmpty = useCallback(() => !editor.current?.textContent, [])
  return (
    <Session answers={answers} roster={roster}>
      <div className="relative max-w-full" style={{ width }}>
        <ModAbovePrompt isWorking={false} sessionId="story-session" isComposerEmpty={isEmpty} />
        <div className="mx-3 mb-1 rounded-xl border border-border px-3 py-2">
          <div ref={editor} contentEditable suppressContentEditableWarning data-chat-input-editor="true" aria-label="Composer" className="min-h-6 text-sm outline-none" />
          <div className="mt-1 flex min-w-0 items-center justify-end gap-1.5">
            <ModSessionMode />
            <span className="size-4 shrink-0 rounded-full border-2 border-muted-foreground/40" aria-hidden />
          </div>
        </div>
      </div>
    </Session>
  )
}

function PaneClosedCard() {
  const answers = useMemo(() => ({}), [])
  return (
    <Session answers={answers} roster={PANES}>
      <div className="h-40 w-[360px] rounded-lg border border-border bg-background">
        <ModPaneBody paneId="gone" placement="dock" className="h-full px-3 py-2" />
      </div>
    </Session>
  )
}

function streamingTurn(): ChatMessage {
  return { id: 'turn-1', role: 'assistant', status: 'streaming', providerId: 'claude', createdAt: new Date(Date.now() - 42_000).toISOString(), content: [{ type: 'text', text: 'Reading the files…' }] }
}

/** The running turn's footer: the Spinner site shows a word only when a mod rewrote it. */
function SpinnerFooter({ answer }: { answer: Answer }) {
  const answers = useMemo(() => ({ Spinner: answer }), [answer])
  const message = useMemo(streamingTurn, [])
  return (
    <Session answers={answers}>
      <div className="w-[420px] max-w-full text-muted-foreground">
        <DurationFooter message={message} parentIsStreaming />
      </div>
    </Session>
  )
}

const meta = {
  title: 'Chat/Mods',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Every element a pane can hold: buttons with hotkeys, markdown, diff and code, input, select, svg, and a Client part. */
export const PaneElements: Story = { render: () => <PaneFrame tree={drawn(PROBE_PANE)} /> }

/** A Client part running in its sandboxed frame: it ticks every 500 ms; its button posts a message and the answered props redraw it. */
export const PaneClient: Story = { render: () => <PaneFrame tree={drawn(CLIENT_PANE)} height={160} /> }

/** A Client module that throws is unmounted and leaves a fault line. */
export const PaneClientFault: Story = { render: () => <PaneFrame tree={drawn(CLIENT_PANE)} height={160} board={FAULTY_BOARD} /> }

/** The same pane in a narrow dock: rows wrap, the frame scrolls. */
export const PaneNarrow: Story = { render: () => <PaneFrame tree={drawn(PROBE_PANE)} width={300} /> }

/** A tree taller than the pane scrolls; `$.ui.scroll` and the wheel move it. */
export const PaneLongContent: Story = { render: () => <PaneFrame tree={drawn(LONG_PANE)} height={260} /> }

/** blast-radius holding a command: Cancel takes the focus, 1 / 2 press. */
export const PaneHold: Story = { render: () => <PaneFrame tree={drawn(BLAST_RADIUS)} height={240} /> }

/** First ask still in flight: the pane stays empty rather than flashing a placeholder. */
export const PaneLoading: Story = { render: () => <PaneFrame tree="pending" /> }

/** The ask failed (runtime released): nothing is drawn. */
export const PaneError: Story = { render: () => <PaneFrame tree="fail" /> }

/** token-weather's one-line band above the composer. */
export const BandLine: Story = { render: () => <Band tree={drawn(TOKEN_WEATHER)} /> }

/** No mod draws the band: it collapses to nothing. */
export const BandEmpty: Story = { render: () => <Band tree={{ tree: { type: 'engine', ref: 0 }, props: {}, hooked: false }} /> }

/** A transcript row no mod hooks: SuperOne's own drawing. */
export const UserMessageOriginal: Story = { render: () => <UserRow answer={{ tree: { type: 'engine', ref: 0 }, props: {}, hooked: false }} /> }

/** A mod wraps the row: its own line above SuperOne's drawing. */
export const UserMessageWrapped: Story = { render: () => <UserRow answer={drawn(Col(T('probe saw a prompt', { dimColor: true }), { type: 'engine', ref: 1 }), userMessageProps('Rename the helper and update its callers'))} /> }

/** A mod rewrites the row's text (`next({ ...e, props })`). */
export const UserMessageRewritten: Story = { render: () => <UserRow answer={drawn({ type: 'engine', ref: 1 }, userMessageProps('[probe] Rename the helper and update its callers'))} /> }

/** A mod replaces the row with its own tree. */
export const UserMessageReplaced: Story = { render: () => <UserRow answer={drawn(T('▶ prompt hidden by a mod', { color: 'cyan' }))} /> }

/** The session draws no mods (another harness, or the preference is off). */
export const UserMessageModsOff: Story = { render: () => <UserRow answer={drawn(T('never shown'))} off /> }

/** A mod line above SuperOne's own question form; the answers stay SuperOne's. */
export const QuestionWrapped: Story = { render: () => <QuestionCard answer={drawn(QUESTION_WRAP)} /> }

/** The phone draws the same form in its chat document, touch-sized with a Dismiss button. */
export const QuestionWrappedTouch: Story = { render: () => <QuestionCard answer={drawn(QUESTION_WRAP)} touch /> }

/** A tree without exactly one engine ref would lose or duplicate the form: SuperOne draws its own. */
export const QuestionWithoutEngine: Story = { render: () => <QuestionCard answer={drawn(T('a mod tried to replace the question'))} /> }

/** A mod rewrote the command's text and the original drawing shows it. */
export const CommandOutputRewritten: Story = {
  render: () => <CommandOutputCard answer={drawn({ type: 'engine', ref: 1 }, commandOutputProps('cost', '', 'Total cost: $0.42 (rewritten by a mod)', false))} />,
}

/** A mod drew a header around the original output. */
export const CommandOutputWrapped: Story = {
  render: () => <CommandOutputCard answer={drawn(Col(T('▸ cost report', { bold: true, color: 'cyan' }), { type: 'engine', ref: 1 }))} />,
}

/** Two panes above the composer while the dock is hidden: tabs switch them (`paneShow`), close asks the plugin; the pane caps at its own `rows`. */
export const AbovePromptInlinePanes: Story = {
  render: () => <Composer roster={PANES} answers={{ 'Pane:probe': drawn(LONG_PANE), 'Pane:blast': drawn(BLAST_RADIUS), AbovePrompt: drawn(TOKEN_WEATHER) }} />,
}

/** One pane: its title and plugin label truncate instead of tabs; a pane without `rows` caps at a third of the window. */
export const AbovePromptSinglePaneNarrow: Story = {
  render: () => <Composer width={360} roster={ONE_PANE} answers={{ Pane: drawn(LONG_PANE) }} />,
}

/** The band alone, with digit hotkeys from the empty composer (1 Proceed, 2 Cancel). */
export const AbovePromptBandHotkeys: Story = {
  render: () => <Composer answers={{ AbovePrompt: drawn(BLAST_RADIUS) }} />,
}

/** No mod draws above the composer: the band collapses and the toolbar shows no session mode. */
export const AbovePromptEmpty: Story = {
  render: () => <Composer answers={{}} />,
}

/** A mod lists session-state labels in the composer toolbar, left of the context ring. */
export const SessionModeLabels: Story = {
  render: () => <Composer answers={{ [`SessionMode:${MOD_SESSION_MODE_INSTANCE}`]: drawn({ type: 'engine', ref: 1 }, sessionModeProps(['memory paused', 'account memory: off'])) }} />,
}

/** A mode label too long for the toolbar truncates before it reaches the send button. */
export const SessionModeLong: Story = {
  render: () => <Composer width={360} answers={{ [`SessionMode:${MOD_SESSION_MODE_INSTANCE}`]: drawn({ type: 'engine', ref: 1 }, sessionModeProps(['a very long session mode label a mod chose to draw here'])) }} />,
}

/** A dock tab whose pane the plugin already closed. */
export const PaneClosed: Story = { render: () => <PaneClosedCard /> }

/** No mod rewrites the spinner: the footer shows only the duration. */
export const FooterSpinnerOriginal: Story = { render: () => <SpinnerFooter answer={{ tree: { type: 'engine', ref: 0 }, props: {}, hooked: false }} /> }

/** A mod rewrote the spinner word: the footer shows it before the duration. */
export const FooterSpinnerRewritten: Story = {
  render: () => <SpinnerFooter answer={drawn({ type: 'engine', ref: 1 }, { ...spinnerProps('Working', null, 'responding'), word: 'Brewing' })} />,
}
