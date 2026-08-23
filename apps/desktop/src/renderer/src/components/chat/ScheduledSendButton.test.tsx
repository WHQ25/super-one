/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ScheduledSend } from '@superone/shared/agent-types'
import { ScheduledSendButton } from './ScheduledSendButton'
import { formatSendTime, toTimeInputValue } from './scheduled-send-time'

// Relative to now on purpose: a queued row is by definition in the future, and
// editing one anchored in the past would exercise a state that cannot occur.
const SEND_AT = (() => {
  const at = new Date()
  at.setDate(at.getDate() + 1)
  at.setHours(14, 30, 0, 0)
  return at.getTime()
})()

function queued(overrides: Partial<ScheduledSend> = {}): ScheduledSend {
  return {
    sessionId: 'sess-1',
    sendAt: SEND_AT,
    message: null,
    armed: false,
    source: 'rate_limit',
    ...overrides,
  }
}

function renderButton(scheduled: ScheduledSend | null, canSend = true) {
  const handlers = {
    onSendNow: vi.fn(),
    onArm: vi.fn(),
    onDisarm: vi.fn(),
    onSetSendAt: vi.fn(),
  }
  render(<ScheduledSendButton scheduled={scheduled} canSend={canSend} {...handlers} />)
  return handlers
}

describe('scheduled send button', () => {
  it('is an ordinary send button while nothing is queued', async () => {
    const { onSendNow, onArm } = renderButton(null)

    await userEvent.click(screen.getByRole('button', { name: /^send$/i }))

    expect(onSendNow).toHaveBeenCalledTimes(1)
    expect(onArm).not.toHaveBeenCalled()
  })

  it('stays disabled when there is nothing to send and nothing queued', () => {
    renderButton(null, false)
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled()
  })

  it('asks rather than states while the offer is unanswered', async () => {
    const { onArm, onSendNow } = renderButton(queued())

    // A clock time the user has not agreed to would read as already decided.
    expect(screen.getByText(/continue on usage reset\?/i)).toBeInTheDocument()
    expect(screen.queryByText(formatSendTime(SEND_AT), { exact: false })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /schedule for/i }))

    expect(onArm).toHaveBeenCalledWith(SEND_AT)
    expect(onSendNow).not.toHaveBeenCalled()
  })

  it('states the committed time once armed', () => {
    renderButton(queued({ armed: true }))
    expect(screen.getByText(formatSendTime(SEND_AT), { exact: false })).toBeInTheDocument()
  })

  it('cancels instead of re-arming once armed', async () => {
    const { onArm, onDisarm } = renderButton(queued({ armed: true }))

    await userEvent.click(screen.getByRole('button', { name: /cancel scheduled send/i }))

    expect(onDisarm).toHaveBeenCalledTimes(1)
    expect(onArm).not.toHaveBeenCalled()
  })

  it('opens the schedule popover on hover without stealing composer focus', async () => {
    renderButton(null)
    const probe = document.createElement('input')
    document.body.append(probe)
    probe.focus()

    await userEvent.hover(screen.getByTestId('scheduled-send'))

    expect(await screen.findByRole('switch', { name: /scheduled send/i })).toBeInTheDocument()
    expect(document.activeElement).toBe(probe)
  })

  it('explains what saying yes does, which the question itself has no room for', async () => {
    renderButton(queued())

    await userEvent.hover(screen.getByTestId('scheduled-send'))

    expect(await screen.findByText(/usage reset at/i)).toBeInTheDocument()
    expect(screen.getByText(/send draft text/i)).toBeInTheDocument()
  })

  it('drops the explanation once the offer has been answered', async () => {
    renderButton(queued({ armed: true }))

    await userEvent.hover(screen.getByTestId('scheduled-send'))
    await screen.findByRole('switch', { name: /scheduled send/i })

    expect(screen.queryByText(/send draft text/i)).toBeNull()
  })

  it('arms from the popover toggle so hover and click agree', async () => {
    const { onArm } = renderButton(queued())

    await userEvent.hover(screen.getByTestId('scheduled-send'))
    await userEvent.click(await screen.findByRole('switch', { name: /scheduled send/i }))

    expect(onArm).toHaveBeenCalledWith(SEND_AT)
  })

  it('re-times an existing queued send from the time field', async () => {
    const { onSetSendAt } = renderButton(queued({ armed: true }))

    await userEvent.hover(screen.getByTestId('scheduled-send'))
    // `fireEvent.change` rather than typing: a time input is segmented, and jsdom
    // does not implement those segments, so per-keystroke typing lands garbage.
    fireEvent.change(await screen.findByLabelText(/^time$/i), { target: { value: '16:45' } })

    // Asserted through the helper rather than a literal epoch: the field carries
    // no date, so the instant it resolves to depends on the day the test runs.
    const at = onSetSendAt.mock.calls.at(-1)?.[0] as number
    expect(toTimeInputValue(at)).toBe('16:45')
    expect(at).toBeGreaterThan(Date.now())
  })
})

describe('scheduled send popover stability', () => {
  it('stays open while the pointer works inside it', async () => {
    renderButton(queued({ armed: true }))

    await userEvent.hover(screen.getByTestId('scheduled-send'))
    const field = await screen.findByLabelText(/^time$/i)
    // Leaving the anchor is what a pointer heading for the panel always does.
    await userEvent.unhover(screen.getByTestId('scheduled-send'))
    await userEvent.click(field)

    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(screen.getByLabelText(/^time$/i)).toBeInTheDocument()
  })

  it('does not let the send button double as a panel toggle', async () => {
    const { onArm } = renderButton(queued())

    await userEvent.hover(screen.getByTestId('scheduled-send'))
    await screen.findByRole('switch', { name: /scheduled send/i })
    await userEvent.click(screen.getByRole('button', { name: /schedule for/i }))

    // The press must reach the button's own handler rather than being spent
    // closing the panel that hover opened.
    expect(onArm).toHaveBeenCalledWith(SEND_AT)
  })
})

describe('scheduled send defaults', () => {
  it('offers a future time even after the composer has sat open for hours', async () => {
    const { onArm } = renderButton(null)

    await userEvent.hover(screen.getByTestId('scheduled-send'))
    await userEvent.click(await screen.findByRole('switch', { name: /scheduled send/i }))

    // A default frozen at mount would arm a send that is already due and fire on
    // the very next poll.
    expect(onArm.mock.calls.at(-1)?.[0]).toBeGreaterThan(Date.now())
  })
})

describe('scheduled send date field', () => {
  it('keeps the calendar folded until the date is what the user came for', async () => {
    renderButton(queued({ armed: true }))

    await userEvent.hover(screen.getByTestId('scheduled-send'))
    const dateButton = await screen.findByRole('button', { expanded: false })
    expect(screen.queryByRole('grid')).toBeNull()

    await userEvent.click(dateButton)

    expect(await screen.findByRole('grid')).toBeInTheDocument()
  })

  it('moves the day without disturbing the time already chosen', async () => {
    const { onSetSendAt } = renderButton(queued({ armed: true }))

    await userEvent.hover(screen.getByTestId('scheduled-send'))
    await userEvent.click(await screen.findByRole('button', { expanded: false }))

    const target = new Date(SEND_AT)
    target.setDate(target.getDate() + 1)
    await userEvent.click(
      screen.getByRole('gridcell', { name: String(target.getDate()) }).querySelector('button')
        ?? screen.getByRole('gridcell', { name: String(target.getDate()) }),
    )

    const at = onSetSendAt.mock.calls.at(-1)?.[0] as number
    expect(toTimeInputValue(at)).toBe('14:30')
    expect(new Date(at).getDate()).toBe(target.getDate())
  })
})
