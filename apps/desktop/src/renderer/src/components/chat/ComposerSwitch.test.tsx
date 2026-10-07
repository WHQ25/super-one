/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposerSwitch } from './ComposerSwitch'

const originalMatchMedia = window.matchMedia

function stubMotion(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: reduced })),
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
})

// jsdom has no AnimationEvent, so React subscribes to the WebKit-prefixed name.
const endAnimation = (element: Element) => {
  fireEvent(element, new Event('webkitAnimationEnd', { bubbles: true }))
}

const render_ = (kind: 'voice' | 'text') => (
  <ComposerSwitch kind={kind} render={(k) => <div data-testid={`${k}-composer`} />} />
)

describe('ComposerSwitch', () => {
  const measuredSlot = (kind: 'short' | 'tall') => (
    <ComposerSwitch kind={kind} render={shown => <div data-measured-height={shown === 'short' ? 80 : 240} />} />
  )
  const measureStage = () => vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return Number(this.querySelector('[data-measured-height]')?.getAttribute('data-measured-height') ?? 0)
  })

  it('expands the slot while the taller composer rises, before its entrance ends', () => {
    stubMotion(false)
    measureStage()
    const { rerender } = render(measuredSlot('short'))
    rerender(measuredSlot('tall'))
    const stage = screen.getByTestId('composer-switch')
    const slot = screen.getByTestId('composer-slot')
    expect(slot.style.height).toBe('80px')
    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'entering')
    expect(slot.style.height).toBe('240px')
    expect(slot).toHaveClass('transition-[height]', 'duration-240', 'ease-[ease-out]')
    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'steady')
    expect(slot.style.height).toBe('')
  })

  it('holds the taller slot until the shorter composer has risen, then shrinks it', () => {
    stubMotion(false)
    measureStage()
    const { rerender } = render(measuredSlot('tall'))
    rerender(measuredSlot('short'))
    const stage = screen.getByTestId('composer-switch')
    const slot = screen.getByTestId('composer-slot')
    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'entering')
    expect(slot.style.height).toBe('240px')
    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'settling')
    expect(slot.style.height).toBe('80px')
    fireEvent.transitionEnd(slot, { propertyName: 'height' })
    expect(stage).toHaveAttribute('data-phase', 'steady')
    expect(slot.style.height).toBe('')
  })

  it('drops the outgoing composer, then raises the incoming one', () => {
    stubMotion(false)
    const { rerender } = render(render_('voice'))
    expect(screen.getByTestId('voice-composer')).toBeInTheDocument()

    rerender(render_('text'))
    // The old composer is still on screen, on its way out.
    const stage = screen.getByTestId('composer-switch')
    expect(stage).toHaveAttribute('data-phase', 'leaving')
    expect(screen.getByTestId('voice-composer')).toBeInTheDocument()
    expect(screen.queryByTestId('text-composer')).toBeNull()
    // The slot holds its height so the transcript above cannot claim the space mid-swap.
    expect(screen.getByTestId('composer-slot').style.height).not.toBe('')

    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'entering')
    expect(screen.getByTestId('text-composer')).toBeInTheDocument()
    expect(screen.queryByTestId('voice-composer')).toBeNull()
    // Equal heights do not need to grow while the newcomer rises.
    expect(screen.getByTestId('composer-slot').style.height).not.toBe('')

    // jsdom measures every box as 0, so the settle is a no-op and completes at once.
    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'steady')
    expect(screen.getByTestId('composer-slot').style.height).toBe('')
  })

  it('clips the slot only while a composer is changing hands', () => {
    stubMotion(false)
    const { rerender } = render(render_('text'))
    // At rest the text composer's popups (@ / todo) hang above the slot, so it must not clip.
    expect(screen.getByTestId('composer-slot')).not.toHaveClass('overflow-hidden')

    expect(screen.getByTestId('composer-slot')).not.toHaveAttribute('data-composer-handoff')

    rerender(render_('voice'))
    expect(screen.getByTestId('composer-slot')).toHaveClass('overflow-hidden')
    // The transcript holds its scroll position while this mark is up.
    expect(screen.getByTestId('composer-slot')).toHaveAttribute('data-composer-handoff')

    const stage = screen.getByTestId('composer-switch')
    endAnimation(stage)
    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'steady')
    expect(screen.getByTestId('composer-slot')).not.toHaveClass('overflow-hidden')
    expect(screen.getByTestId('composer-slot')).not.toHaveAttribute('data-composer-handoff')
  })

  it("reports how far the slot stands above the base composer's resting height", () => {
    stubMotion(false)
    measureStage()
    let notify = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { notify = cb }
      observe() {}
      disconnect() {}
    })
    const onOverhangChange = vi.fn()
    const slot = (kind: 'short' | 'tall') => (
      <ComposerSwitch kind={kind} align={{ kind: 'tall', to: 'short' }} onOverhangChange={onOverhangChange}
        render={shown => <div data-measured-height={shown === 'short' ? 80 : 240} />} />
    )
    const { rerender, unmount } = render(slot('short'))
    notify()
    expect(onOverhangChange).toHaveBeenLastCalledWith(0)
    rerender(slot('tall'))
    const stage = screen.getByTestId('composer-switch')
    endAnimation(stage)
    endAnimation(stage)
    notify()
    expect(onOverhangChange).toHaveBeenLastCalledWith(160)
    unmount()
    expect(onOverhangChange).toHaveBeenLastCalledWith(0)
    vi.unstubAllGlobals()
  })

  it('applies a height cap to tall composers', () => {
    render(
      <ComposerSwitch
        kind="text"
        maxHeight={440}
        render={() => <div>text</div>}
      />,
    )
    expect((screen.getByTestId('composer-slot') as HTMLDivElement).style.maxHeight).toBe('440px')
  })

  it('retains the outgoing height cap until its exit finishes', () => {
    stubMotion(false)
    const preview = (kind: 'capped' | 'text') => <ComposerSwitch kind={kind} maxHeight={kind === 'capped' ? 120 : undefined} render={shown => <div>{shown}</div>} />
    const { rerender } = render(preview('capped'))
    rerender(preview('text'))
    const stage = screen.getByTestId('composer-switch')
    const slot = screen.getByTestId('composer-slot')
    expect(stage).toHaveAttribute('data-phase', 'leaving')
    expect(stage.style.maxHeight).toBe('120px')
    expect(slot.style.maxHeight).toBe('120px')
    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'entering')
    expect(stage.style.maxHeight).toBe('')
    expect(slot.style.maxHeight).toBe('')
  })

  it('cancels the hand-off when the target flips back mid-exit', () => {
    stubMotion(false)
    const { rerender } = render(render_('text'))
    rerender(render_('voice'))
    expect(screen.getByTestId('composer-switch')).toHaveAttribute('data-phase', 'leaving')
    rerender(render_('text'))
    expect(screen.getByTestId('composer-switch')).toHaveAttribute('data-phase', 'steady')
    expect(screen.getByTestId('text-composer')).toBeInTheDocument()
  })

  it('grows only the aligned composer to the text composer height', () => {
    stubMotion(true)
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(120)
    const slot = (kind: 'text' | 'voice' | 'decision') => (
      <ComposerSwitch kind={kind} align={{ kind: 'voice', to: 'text' }} render={(k) => <div data-testid={`${k}-composer`} />} />
    )
    const { rerender } = render(slot('text'))
    rerender(slot('decision'))
    expect(screen.getByTestId('composer-switch').style.minHeight).toBe('')
    rerender(slot('voice'))
    expect(screen.getByTestId('composer-switch').style.minHeight).toBe('120px')
    offsetHeight.mockRestore()
  })

  it('switches at once under reduced motion or without animation support', () => {
    stubMotion(true)
    const { rerender } = render(render_('voice'))
    rerender(render_('text'))
    expect(screen.getByTestId('text-composer')).toBeInTheDocument()
    expect(screen.getByTestId('composer-switch')).toHaveAttribute('data-phase', 'steady')

    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined })
    rerender(render_('voice'))
    expect(screen.getByTestId('voice-composer')).toBeInTheDocument()
  })

  it('animates consecutive requests of the same kind without replacing the outgoing content', () => {
    stubMotion(false)
    const request = (id: string) => <ComposerSwitch kind="decision" transitionKey={id} render={() => <div>{id}</div>} />
    const { rerender } = render(request('permission-1'))
    rerender(request('permission-2'))
    const stage = screen.getByTestId('composer-switch')
    expect(stage).toHaveAttribute('data-phase', 'leaving')
    expect(screen.getByText('permission-1')).toBeInTheDocument()
    expect(screen.queryByText('permission-2')).toBeNull()
    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'entering')
    expect(screen.getByText('permission-2')).toBeInTheDocument()
    endAnimation(stage)

    rerender(request('question-1'))
    expect(stage).toHaveAttribute('data-phase', 'leaving')
    expect(screen.getByText('permission-2')).toBeInTheDocument()
    endAnimation(stage)
    expect(screen.getByText('question-1')).toBeInTheDocument()
  })

  it('keeps the entering snapshot intact when another request arrives mid-rise', () => {
    stubMotion(false)
    const request = (id: string) => <ComposerSwitch kind="decision" transitionKey={id} render={() => <div>{id}</div>} />
    const { rerender } = render(request('first'))
    rerender(request('second'))
    const stage = screen.getByTestId('composer-switch')
    endAnimation(stage)
    rerender(request('third'))
    expect(stage).toHaveAttribute('data-phase', 'entering')
    expect(screen.getByText('second')).toBeInTheDocument()
    expect(screen.queryByText('third')).toBeNull()
    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'leaving')
    endAnimation(stage)
    expect(screen.getByText('third')).toBeInTheDocument()
  })

  it('cancels a keyed exit and switches keyed requests directly with reduced motion', () => {
    stubMotion(false)
    const request = (id: string) => <ComposerSwitch kind="decision" transitionKey={id} render={() => <div>{id}</div>} />
    const { rerender } = render(request('first'))
    rerender(request('second'))
    rerender(request('first'))
    expect(screen.getByTestId('composer-switch')).toHaveAttribute('data-phase', 'steady')
    expect(screen.getByText('first')).toBeInTheDocument()
    stubMotion(true)
    rerender(request('second'))
    expect(screen.getByTestId('composer-switch')).toHaveAttribute('data-phase', 'steady')
    expect(screen.getByText('second')).toBeInTheDocument()
  })
})
