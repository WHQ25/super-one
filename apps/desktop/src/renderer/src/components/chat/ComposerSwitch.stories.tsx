import { useCallback, useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { publishComposerOverhang, useChatScroll } from '@/hooks/useChatScroll'
import { ComposerSwitch } from './ComposerSwitch'
import { COMPOSER_IDS, type ComposerId } from './composer-slot/resolve-composer'

const COMPOSER_HEIGHTS: Record<string, number> = { text: 114, voice: 96, decision: 340, 'app-consent': 180, 'app-input': 560 }

/** Like ChatInput restoring the caret after a decision: it focuses while the stage is still below the slot. */
function FocusOnMount() {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return <textarea ref={ref} data-testid="text-composer-input" aria-label="Message" className="mt-2 block h-8 w-full resize-none rounded border border-border bg-transparent text-xs" />
}

function ComposerSwitchPreview({ narrow = false, landing = false, streaming = false }: { narrow?: boolean; landing?: boolean; streaming?: boolean }) {
  const [lines, setLines] = useState(1)
  useEffect(() => {
    if (!streaming) return
    const timer = setInterval(() => setLines(value => value + 1), 80)
    return () => clearInterval(timer)
  }, [streaming])
  const [kind, setKind] = useState<ComposerId>('text')
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  useChatScroll({ scrollViewportRef })
  const publishOverhang = useCallback((px: number) => {
    publishComposerOverhang(rootRef.current, px)
  }, [])
  return (
    <div style={{ width: narrow ? 320 : 760 }}>
      <div className="mb-4 flex flex-wrap gap-2">
        {COMPOSER_IDS.map((id) => (
          <button
            key={id}
            data-target-composer={id}
            type="button"
            onClick={() => setKind(id)}
            className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
          >
            {id}
          </button>
        ))}
      </div>
      {/* Mirrors SessionPane + ChatContent: following history stays still while another composer
          stands in, and the landing stays centred as if the text composer held the slot. */}
      <div data-testid="handoff-pane" className="flex h-120 flex-col overflow-hidden">
      <div ref={rootRef} data-chat-root="" data-testid="handoff-preview" className="flex min-h-0 flex-1 flex-col overflow-clip rounded-xl border border-border">
        <div data-testid="handoff-transcript" className="relative min-h-0 flex-1 overflow-hidden">
          {landing ? (
            <div data-testid="handoff-landing" className="flex h-full flex-col items-center justify-center gap-2">
              <div className="size-10 rounded-full bg-muted" />
              <div className="text-sm text-muted-foreground">Chat suggestions</div>
            </div>
          ) : (
            <div ref={scrollViewportRef} className="h-full overflow-y-auto">
              <div className="flex flex-col gap-2 p-3">
                {Array.from({ length: 16 }, (_, index) => <div key={index} data-message-index={index} className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Chat message {index + 1}</div>)}
                {streaming && <div data-streaming-tail className="whitespace-pre-line text-xs">{Array.from({ length: lines }, () => 'Streaming response…').join('\n')}</div>}
              </div>
            </div>
          )}
        </div>
        <ComposerSwitch
          kind={kind}
          align={{ kind: 'voice', to: 'text' }}
          onOverhangChange={publishOverhang}
          maxHeight={kind === 'app-input' ? 360 : undefined}
          render={(id) => (
            <div data-composer={id} className="min-h-0 overflow-y-auto rounded-lg border border-border bg-card p-4" style={{ height: COMPOSER_HEIGHTS[id] }}>
              <div data-composer-top="" className="text-sm font-medium">{id} composer</div>
              {id === 'text' ? <FocusOnMount /> : <div className="mt-2 text-xs text-muted-foreground">Use the buttons above to hand off between slot entries.</div>}
              {id === 'app-input' && Array.from({ length: 16 }, (_, index) => <div key={index} className="mt-4 text-xs text-muted-foreground">Form field {index + 1}</div>)}
            </div>
          )}
        />
      </div>
      </div>
    </div>
  )
}

const meta = {
  title: 'Chat/ComposerSwitch',
  component: ComposerSwitchPreview,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ComposerSwitchPreview>

export default meta
type Story = StoryObj<typeof meta>

export const Handoff: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pane = canvas.getByTestId('handoff-pane')
    const root = canvas.getByTestId('handoff-preview')
    const frame = canvas.getByTestId('handoff-transcript')
    const viewport = frame.firstElementChild as HTMLElement
    const message = viewport.querySelector('[data-message-index="15"]')!
    const height = frame.clientHeight
    const top = viewport.scrollTop
    const onScreen = message.getBoundingClientRect().top
    for (const kind of ['decision', 'app-input', 'text']) {
      await userEvent.click(canvas.getByRole('button', { name: kind }))
      // Check every rendered frame, including the outgoing card's drop. The
      // text composer takes focus while it still sits below the slot; that
      // must not scroll the pane and carry history with it.
      const until = performance.now() + 500
      while (performance.now() < until) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        expect(frame.clientHeight).toBe(height)
        expect(Math.abs(viewport.scrollTop - top)).toBeLessThanOrEqual(1)
        expect(pane.scrollTop).toBe(0)
        expect(root.scrollTop).toBe(0)
        expect(Math.abs(message.getBoundingClientRect().top - onScreen)).toBeLessThanOrEqual(1)
      }
      await waitFor(() => expect(canvas.getByTestId('composer-switch')).toHaveAttribute('data-phase', 'steady'))
    }
    await expect(canvas.getByTestId('text-composer-input')).toHaveFocus()
  },
}
export const Narrow: Story = { ...Handoff, args: { narrow: true } }
export const Dark: Story = { ...Handoff, globals: { theme: 'dark' } }
/** Empty pane: the landing keeps its place while other composers stand in. */
export const Landing: Story = { args: { landing: true } }

/** Continuous content growth exercises the same ResizeObserver follow path as token streaming. */
export const Streaming: Story = { args: { streaming: true } }
export const StreamingNarrow: Story = { args: { streaming: true, narrow: true } }
export const StreamingDark: Story = { args: { streaming: true }, globals: { theme: 'dark' } }
