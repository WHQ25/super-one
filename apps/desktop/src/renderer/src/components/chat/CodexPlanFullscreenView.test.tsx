/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodexPlanFullscreenView } from './CodexPlanFullscreenView'

vi.mock('@/components/MarkdownPreview', () => ({
  MarkdownView: ({ content }: { content: string }) => <div>{content}</div>,
}))

describe('CodexPlanFullscreenView', () => {
  it('submits footer feedback when rejecting from fullscreen', () => {
    const onClose = vi.fn()
    const onApprovePlan = vi.fn()
    const onRejectPlan = vi.fn()

    const view = render(
      <CodexPlanFullscreenView
        text="## Plan"
        onClose={onClose}
        onApprovePlan={onApprovePlan}
        onRejectPlan={onRejectPlan}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Reject feedback (optional, Enter to submit)'), {
      target: { value: 'Keep the scope minimal.' },
    })
    fireEvent.click(screen.getByText('Reject'))

    expect(onRejectPlan).toHaveBeenCalledWith('Keep the scope minimal.')
    expect(onClose).toHaveBeenCalledWith('reject')
    expect(onApprovePlan).not.toHaveBeenCalled()
  })

  it('approves from fullscreen without using reject feedback', () => {
    const onClose = vi.fn()
    const onApprovePlan = vi.fn()
    const onRejectPlan = vi.fn()

    const view = render(
      <CodexPlanFullscreenView
        text="## Plan"
        onClose={onClose}
        onApprovePlan={onApprovePlan}
        onRejectPlan={onRejectPlan}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Reject feedback (optional, Enter to submit)'), {
      target: { value: 'Should be ignored.' },
    })
    fireEvent.click(screen.getByText('Approve'))

    expect(onApprovePlan).toHaveBeenCalledTimes(1)
    expect(onRejectPlan).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledWith('approve')
  })

  it('hides approval footer when no plan actions are available', () => {
    render(
      <CodexPlanFullscreenView
        text="## Plan"
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.queryByText('Reject')).toBeNull()
  })

  it('supports Enter, Escape and Tab shortcuts in the footer', () => {
    const onClose = vi.fn()
    const onApprovePlan = vi.fn()
    const onRejectPlan = vi.fn()

    const view = render(
      <div data-chat-root="" tabIndex={-1}>
        <CodexPlanFullscreenView
          text="## Plan"
          onClose={onClose}
          onApprovePlan={onApprovePlan}
          onRejectPlan={onRejectPlan}
        />
      </div>,
    )
    ;(view.container.querySelector('[data-chat-root]') as HTMLElement).focus()

    const feedback = screen.getByPlaceholderText('Reject feedback (optional, Enter to submit)') as HTMLInputElement
    const rejectButton = screen.getByRole('button', { name: /Reject/i })
    expect(within(rejectButton).getByText('esc')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(feedback)
    expect(within(rejectButton).getByText('↵')).toBeTruthy()

    fireEvent.change(feedback, { target: { value: 'Needs a smaller scope.' } })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onRejectPlan).toHaveBeenCalledWith('Needs a smaller scope.')
    expect(onClose).toHaveBeenLastCalledWith('reject')

    view.unmount()
    onClose.mockReset()
    onRejectPlan.mockReset()
    const again = render(
      <div data-chat-root="" tabIndex={-1}>
        <CodexPlanFullscreenView
          text="## Plan"
          onClose={onClose}
          onApprovePlan={onApprovePlan}
          onRejectPlan={onRejectPlan}
        />
      </div>,
    )
    ;(again.container.querySelector('[data-chat-root]') as HTMLElement).focus()

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onApprovePlan).toHaveBeenCalled()
    expect(onClose).toHaveBeenLastCalledWith('approve')
  })
})
