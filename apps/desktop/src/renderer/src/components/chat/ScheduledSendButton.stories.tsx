import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Paperclip } from 'lucide-react'
import type { ScheduledSend } from '@superone/shared/agent-types'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { ScheduledSendButton } from './ScheduledSendButton'

const HOUR_MS = 3_600_000

function seed(overrides: Partial<ScheduledSend> = {}): ScheduledSend {
  return {
    sessionId: 'sb',
    sendAt: Date.now() + 2 * HOUR_MS + 12 * 60_000,
    message: null,
    armed: false,
    source: 'rate_limit',
    ...overrides,
  }
}

/**
 * The control only makes sense in the seat it occupies, so the harness draws the
 * composer around it. State is local here — in the app the row lives in main,
 * which is exactly why the component owns none of it.
 */
function Harness({ initial }: { initial: ScheduledSend | null }) {
  const [row, setRow] = useState<ScheduledSend | null>(initial)
  const [draft, setDraft] = useState(
    initial?.armed ? '' : 'Finish the remaining migration files, then run the tests.',
  )
  const [sentLog, setSentLog] = useState<string | null>(null)

  return (
    <div className="@container w-[680px]">
      <div className="rounded-xl border border-border bg-background px-3 py-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder="Send a message…"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <IconButton size="sm"><Paperclip /></IconButton>
            <span className="text-xs">Opus 5</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">32%</span>
            <ScheduledSendButton
              scheduled={row}
              canSend={draft.trim().length > 0}
              onSendNow={() => {
                setSentLog(draft)
                setDraft('')
              }}
              onArm={(sendAt) => {
                setRow({ ...(row ?? seed({ source: 'manual' })), sendAt, armed: true, message: draft.trim() || row?.message || null })
                setDraft('')
              }}
              onDisarm={() => {
                setDraft(row?.message ?? '')
                if (row?.source === 'manual') setRow(null)
                else if (row) setRow({ ...row, armed: false, message: null })
              }}
              onSetSendAt={(sendAt) => setRow((prev) => (prev ? { ...prev, sendAt } : prev))}
            />
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {/* The unroll only plays when the label mounts, so watching it means
            making the offer *arrive* rather than starting a story already in
            that state — which is what this trigger is for. */}
        <button
          type="button"
          onClick={() => setRow(row ? null : seed())}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {row ? 'Clear schedule' : 'Simulate rate limit'}
        </button>
        <p className="font-mono text-xs text-muted-foreground">
          {row?.armed
            ? `→ queued for ${new Date(row.sendAt).toLocaleTimeString()}: ${JSON.stringify(row.message ?? 'Continue')}`
            : sentLog
              ? `→ sent now: ${JSON.stringify(sentLog)}`
              : '→ nothing scheduled'}
        </p>
      </div>
    </div>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'ClaudeCode/ScheduledSendButton',
  component: Harness,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof Harness>

/**
 * Nothing queued — an ordinary send button, with the schedule popover on hover.
 * Hit "Simulate rate limit" to watch the label unroll out of the circle live;
 * the other stories start already expanded, so they show the resting shape only.
 */
export const Idle: Story = {
  args: { initial: null },
}

/**
 * The moment a turn is cut off on quota: the label unrolls out of the circle with
 * the reset time already filled in, and the check is the consent.
 */
export const RateLimitOffer: Story = {
  args: { initial: seed() },
}

/** Accepted — the scheduler now owes this session a send at the shown time. */
export const Armed: Story = {
  args: { initial: seed({ armed: true, message: 'Finish the remaining migration files, then run the tests.' }) },
}

/** Queued by hand from the popover, with no rate limit involved. */
export const ManualSchedule: Story = {
  args: { initial: seed({ armed: true, source: 'manual', message: 'Run the full suite and summarise failures.' }) },
}
