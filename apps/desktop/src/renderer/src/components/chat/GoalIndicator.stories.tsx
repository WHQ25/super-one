import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Paperclip } from 'lucide-react'
import type { SessionGoal } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { GoalIndicator } from './GoalIndicator'

const GROK = HARNESS_CAPABILITIES.acp.goal!
const CLAUDE = HARNESS_CAPABILITIES.claude.goal!

interface HarnessProps {
  harnessName: string
  capability: typeof GROK
  initial: SessionGoal | null
  /** Start in goal mode — the composer's next send becomes the objective. */
  composing?: boolean
  /** Reject every transition, to show the popover's inline error. */
  failing?: boolean
}

/**
 * The chip only reads right in the seat it occupies, so the story draws the
 * composer around it. Goal transitions are local here; in the app they are a
 * `/goal …` turn or a Codex RPC and come back as a `session_goal` event.
 */
function Harness({ harnessName, capability, initial, composing: initialComposing = false, failing = false }: HarnessProps) {
  const [goal, setGoal] = useState<SessionGoal | null>(initial)
  const [composing, setComposing] = useState(initialComposing)
  const [draft, setDraft] = useState('')

  const transition = (next: () => void) => async () => {
    await new Promise((r) => setTimeout(r, 300))
    if (failing) throw new Error('agent is offline')
    next()
  }

  const placeholder = composing
    ? capability.semantics === 'condition'
      ? `Describe the condition ${harnessName} must satisfy before it stops…`
      : `Describe the objective ${harnessName} should pursue until it is complete…`
    : `Message ${harnessName}…`

  return (
    <div className="w-[680px]">
      <div className="rounded-xl border border-border bg-background px-3 py-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setComposing(false)
            if (e.key === 'Enter' && !e.shiftKey && composing && draft.trim()) {
              e.preventDefault()
              setGoal({ objective: draft.trim(), status: 'active' })
              setComposing(false)
              setDraft('')
            }
          }}
          rows={2}
          className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder={placeholder}
        />
        <div className="mt-1.5 flex items-center gap-2 text-muted-foreground">
          <IconButton size="sm"><Paperclip /></IconButton>
          <span className="text-xs">Opus 5</span>
          {(goal || composing) && (
            <GoalIndicator
              goal={goal}
              capability={capability}
              harnessName={harnessName}
              composing={composing}
              onExitCompose={() => setComposing(false)}
              onDismiss={() => setGoal(null)}
              onEdit={() => {
                setDraft(goal?.objective ?? '')
                setComposing(true)
              }}
              onClear={transition(() => setGoal(null))}
              onPause={transition(() => setGoal((g) => (g ? { ...g, status: 'paused' } : g)))}
              onResume={transition(() => setGoal((g) => (g ? { ...g, status: 'active' } : g)))}
            />
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {!composing && !goal && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            /goal
          </button>
        )}
        <p className="font-mono text-xs text-muted-foreground">
          {composing
            ? '→ goal mode: Enter sets, Esc leaves'
            : goal
              ? `→ ${goal.status}: ${JSON.stringify(goal.objective)}`
              : '→ no goal'}
        </p>
      </div>
    </div>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Tool UI/General/GoalIndicator',
  component: Harness,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof Harness>

/** Goal mode before anything is set: the chip mirrors Codex plan mode, with the exit control on hover. */
export const Composing: Story = {
  args: { harnessName: 'Grok', capability: GROK, initial: null, composing: true },
}

/** A goal being pursued — the icon breathes; open the popover to pause or clear it. */
export const Active: Story = {
  args: { harnessName: 'Grok', capability: GROK, initial: { objective: 'Migrate the auth module to the new API and land the tests', status: 'active' } },
}

/** Paused: the icon rests and the popover offers Resume. */
export const Paused: Story = {
  args: { harnessName: 'Grok', capability: GROK, initial: { objective: 'Migrate the auth module to the new API and land the tests', status: 'paused', lastReason: 'Paused by user' } },
}

/** Blocked counts as resumable — the user is how the agent gets unstuck. */
export const Blocked: Story = {
  args: { harnessName: 'Grok', capability: GROK, initial: { objective: 'Ship the login flow', status: 'blocked', lastReason: 'Needs the staging credentials' } },
}

/** The harness reported the goal complete: green check, "Goal Achieved", only Clear left in the popover. */
export const Achieved: Story = {
  args: { harnessName: 'Grok', capability: GROK, initial: { objective: 'Migrate the auth module to the new API and land the tests', status: 'complete', tokensUsed: 182_000 } },
}

/** Claude has no pause lifecycle, so the popover omits those controls and reports the evaluator instead. */
export const ClaudeCondition: Story = {
  args: {
    harnessName: 'Claude',
    capability: CLAUDE,
    initial: { objective: 'The whole test suite passes and typecheck is green', status: 'active', lastReason: 'still checking the auth suite' },
  },
}

/** Editing a live goal: the chip flips to goal mode with the objective back in the composer. */
export const Editing: Story = {
  args: { harnessName: 'Grok', capability: GROK, initial: { objective: 'Ship the login flow', status: 'active' }, composing: true },
}

/** A long objective is clamped in the popover rather than growing it. */
export const LongObjective: Story = {
  args: {
    harnessName: 'Codex',
    capability: HARNESS_CAPABILITIES.codex.goal!,
    initial: {
      objective: 'Replace every call site of the legacy HTTP client with the new fetch wrapper, keep the retry semantics identical, add contract tests for each endpoint family, update the ADR, and make sure the release notes mention the behaviour change for 4xx responses. '.repeat(3),
      status: 'active',
      tokensUsed: 182_000,
      tokenBudget: 500_000,
    },
  },
}

/** Every transition fails — the popover keeps the error inline instead of closing. */
export const TransitionError: Story = {
  args: { harnessName: 'Grok', capability: GROK, initial: { objective: 'Ship the login flow', status: 'active' }, failing: true },
}
