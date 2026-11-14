import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fireEvent, userEvent, waitFor } from 'storybook/test'
import { cn } from '@superone/ui/lib/utils'
import { ChatScrollIndicator } from './ChatScrollIndicator'
import type { TurnOutlineEntry } from './turn-outline'

function buildEntries(count: number): TurnOutlineEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `turn-${index + 1}`,
    index,
    text: `Turn ${index + 1}\nSummary for turn ${index + 1}`,
    reply: `Assistant reply preview for turn ${index + 1}`,
    createdAt: '2026-11-14T12:00:00.000Z',
  }))
}

function ChatScrollIndicatorPreview({
  count = 60,
  glass = false,
  height = 240,
}: {
  count?: number
  glass?: boolean
  height?: number
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [jumpedTo, setJumpedTo] = useState<string | null>(null)
  const entries = buildEntries(count)

  return (
    <div
      className={cn('rounded-xl p-5', glass && 'liquid-glass dark')}
      style={glass ? { background: 'linear-gradient(135deg, #b89858, #2d3e4e)' } : undefined}
    >
      <div
        className="relative w-72 overflow-hidden rounded-xl border border-border bg-card p-3"
        style={{ height }}
      >
        <div
          ref={viewportRef}
          className="h-full overflow-y-auto pr-7 text-xs text-muted-foreground"
        >
          {entries.map((entry) => (
            <div key={entry.id} data-message-id={entry.id} className="py-2">
              {entry.text.split('\n')[0]}
            </div>
          ))}
        </div>
        <ChatScrollIndicator
          entries={entries}
          viewportRef={viewportRef}
          onJump={(id) => setJumpedTo(id)}
        />
        {jumpedTo && (
          <div data-testid="jumped-to" className="sr-only">
            {jumpedTo}
          </div>
        )}
      </div>
    </div>
  )
}

const meta = {
  title: 'Chat/ChatScrollIndicator',
  component: ChatScrollIndicatorPreview,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatScrollIndicatorPreview>

export default meta
type Story = StoryObj<typeof meta>

export const FewTicks: Story = {
  args: { count: 8, glass: false },
}

export const ManyTicksLight: Story = {
  args: { count: 60, glass: false },
  globals: { theme: 'light' },
}

export const ManyTicksDark: Story = {
  args: { count: 60, glass: false },
  globals: { theme: 'dark' },
}

export const ManyTicksGlassDark: Story = {
  args: { count: 60, glass: true },
  globals: { theme: 'dark' },
  play: async ({ canvasElement }) => {
    const rail = canvasElement.querySelector('[data-chat-scroll-indicator]') as HTMLElement
    const scroller = rail.querySelector('.scroll-edge-fade-y') as HTMLElement
    expect(scroller).not.toBeNull()
    expect(rail.querySelector('[data-mod-edge-fade]')).toBeNull()
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    fireEvent.scroll(scroller, { target: { scrollTop: 40 } })
    const ticks = rail.querySelectorAll<HTMLButtonElement>('[data-tick]')
    await userEvent.hover(ticks[10])
    await waitFor(() => {
      expect(canvasElement.querySelector('[role="tooltip"]')).not.toBeNull()
    })
    await userEvent.click(ticks[10])
    expect(canvasElement.querySelector('[data-testid="jumped-to"]')?.textContent).toBe('turn-11')
  },
}
