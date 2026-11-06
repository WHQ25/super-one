import { useCallback, useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { publishComposerOverhang, useChatScroll } from '@/hooks/useChatScroll'
import { ComposerSwitch } from './ComposerSwitch'
import { COMPOSER_IDS, type ComposerId } from './composer-slot/resolve-composer'

const COMPOSER_HEIGHTS: Record<string, number> = { text: 114, voice: 96, decision: 340, 'app-consent': 180, 'app-input': 560 }

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
      {/* Mirrors ChatContent: following history stays still while another composer stands in, and
          the landing stays centred as if the text composer held the slot. */}
      <div ref={rootRef} data-chat-root="" data-testid="handoff-preview" className="flex h-120 flex-col overflow-hidden rounded-xl border border-border">
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
              <div className="mt-2 text-xs text-muted-foreground">Use the buttons above to hand off between slot entries.</div>
              {id === 'app-input' && Array.from({ length: 16 }, (_, index) => <div key={index} className="mt-4 text-xs text-muted-foreground">Form field {index + 1}</div>)}
            </div>
          )}
        />
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
    const frame = canvas.getByTestId('handoff-transcript')
    const viewport = frame.firstElementChild as HTMLElement
    const height = frame.clientHeight
    const top = viewport.scrollTop
    for (const kind of ['decision', 'app-input', 'text']) {
      await userEvent.click(canvas.getByRole('button', { name: kind }))
      // Check every rendered frame, including the outgoing card's drop.
      const until = performance.now() + 500
      while (performance.now() < until) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        expect(frame.clientHeight).toBe(height)
        expect(Math.abs(viewport.scrollTop - top)).toBeLessThanOrEqual(1)
      }
      await waitFor(() => expect(canvas.getByTestId('composer-switch')).toHaveAttribute('data-phase', 'steady'))
    }
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
