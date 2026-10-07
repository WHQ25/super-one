import { useCallback, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useChatScroll } from '@/hooks/useChatScroll'
import { ComposerSwitch } from './ComposerSwitch'
import { COMPOSER_IDS, type ComposerId } from './composer-slot/resolve-composer'

const COMPOSER_HEIGHTS: Record<string, number> = { text: 114, voice: 96, decision: 340, 'app-consent': 180, 'app-input': 560 }

function ComposerSwitchPreview({ narrow = false, landing = false }: { narrow?: boolean; landing?: boolean }) {
  const [kind, setKind] = useState<ComposerId>('text')
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  useChatScroll({ scrollViewportRef })
  const publishOverhang = useCallback((px: number) => {
    rootRef.current?.style.setProperty('--composer-overhang', `${px}px`)
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
      {/* Mirrors ChatContent: history keeps its scroll position through a hand-off, and
          the landing stays centred as if the text composer held the slot. */}
      <div ref={rootRef} data-chat-root="" data-testid="handoff-preview" className="flex h-120 flex-col overflow-hidden rounded-xl border border-border">
        <div data-testid="handoff-transcript" className="relative min-h-0 flex-1 overflow-hidden">
          {landing ? (
            <div data-testid="handoff-landing" className="flex h-full flex-col items-center justify-center gap-2" style={{ translate: '0 calc(var(--composer-overhang, 0px) / 2)' }}>
              <div className="size-10 rounded-full bg-muted" />
              <div className="text-sm text-muted-foreground">Chat suggestions</div>
            </div>
          ) : (
            <div ref={scrollViewportRef} className="h-full overflow-y-auto">
              <div className="flex flex-col gap-2 p-3">
                {Array.from({ length: 16 }, (_, index) => <div key={index} data-message-index={index} className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Chat message {index + 1}</div>)}
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

export const Handoff: Story = {}
export const Narrow: Story = { args: { narrow: true } }
/** Empty pane: the landing keeps its place while other composers stand in. */
export const Landing: Story = { args: { landing: true } }
