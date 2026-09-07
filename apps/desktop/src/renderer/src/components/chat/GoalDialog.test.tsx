/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SessionGoal } from '@superone/shared/agent-types'
import type { GoalCapability } from '@superone/shared/harness/harness-capabilities'
import { GoalDialog } from './GoalDialog'

const OBJECTIVE: GoalCapability = {
  lifecycleArgs: [],
  canPause: true,
  transport: 'rpc',
  semantics: 'objective',
}

const CONDITION: GoalCapability = {
  lifecycleArgs: ['clear'],
  canPause: false,
  transport: 'slash',
  semantics: 'condition',
}

function renderDialog(props: Partial<Parameters<typeof GoalDialog>[0]> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onClear = vi.fn().mockResolvedValue(undefined)
  const onOpenChange = vi.fn()
  render(
    <GoalDialog
      open
      onOpenChange={onOpenChange}
      existing={null}
      capability={OBJECTIVE}
      harnessName="Codex"
      onSave={onSave}
      onClear={onClear}
      {...props}
    />,
  )
  return { onSave, onClear, onOpenChange }
}

describe('GoalDialog', () => {
  it('saves a trimmed objective and closes', async () => {
    const { onSave, onOpenChange } = renderDialog()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Migrate auth  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save goal' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Migrate auth'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('will not save an empty goal', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: 'Save goal' })).toBeDisabled()
  })

  it('asks for a condition, not an objective, when that is what the harness wants', () => {
    renderDialog({ capability: CONDITION, harnessName: 'Claude' })

    expect(
      screen.getByText(/Set a condition Claude checks before it stops/),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'placeholder',
      expect.stringContaining('the whole test suite passes'),
    )
  })

  it('prefills from the existing goal so editing is not retyping', () => {
    const existing: SessionGoal = { objective: 'Migrate auth', status: 'paused' }
    renderDialog({ existing })

    expect(screen.getByRole('textbox')).toHaveValue('Migrate auth')
    expect(screen.getByText('Status: Paused')).toBeInTheDocument()
  })

  it('lets a composer prefill win over the existing goal', () => {
    const existing: SessionGoal = { objective: 'Migrate auth', status: 'active' }
    renderDialog({ existing, prefill: 'Rewrite the router' })

    expect(screen.getByRole('textbox')).toHaveValue('Rewrite the router')
  })

  it('offers clear only once there is something to clear', async () => {
    const { onClear } = renderDialog({ existing: { objective: 'Migrate auth', status: 'active' } })

    fireEvent.click(screen.getByRole('button', { name: 'Clear goal' }))
    await waitFor(() => expect(onClear).toHaveBeenCalled())
  })

  it('hides clear when there is no goal yet', () => {
    renderDialog()
    expect(screen.queryByRole('button', { name: 'Clear goal' })).toBeNull()
  })

  it('explains why the harness cannot take a goal yet instead of failing on save', () => {
    renderDialog({ unavailable: true })

    expect(screen.getByText(/Send a message first to start the session/)).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save goal' })).toBeDisabled()
  })

  it('keeps the dialog open and shows why a save failed', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('thread is gone'))
    const { onOpenChange } = renderDialog({ onSave })

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Migrate auth' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save goal' }))

    await waitFor(() => expect(screen.getByText('thread is gone')).toBeInTheDocument())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('keeps what the user typed when a live goal snapshot arrives', () => {
    // Codex re-reads `thread/goal/get` before every goal-driven turn, so an open
    // editor sees a fresh `existing` object while the user is still typing.
    const goal: SessionGoal = { objective: 'Migrate auth', status: 'active', tokensUsed: 10 }
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      capability: OBJECTIVE,
      harnessName: 'Codex',
      prefill: 'Migrate auth',
      onSave: vi.fn().mockResolvedValue(undefined),
    }
    const { rerender } = render(<GoalDialog {...props} existing={goal} />)

    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Migrate auth and land the tests' } })
    rerender(<GoalDialog {...props} existing={{ ...goal, tokensUsed: 20 }} />)

    expect(box.value).toBe('Migrate auth and land the tests')
  })

  it('re-seeds from the goal the next time it opens', () => {
    const props = {
      onOpenChange: vi.fn(),
      capability: OBJECTIVE,
      harnessName: 'Codex',
      existing: { objective: 'Migrate auth', status: 'active' } as SessionGoal,
      onSave: vi.fn().mockResolvedValue(undefined),
    }
    const { rerender } = render(<GoalDialog {...props} open />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abandoned draft' } })

    rerender(<GoalDialog {...props} open={false} />)
    rerender(<GoalDialog {...props} open />)

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Migrate auth')
  })
})
