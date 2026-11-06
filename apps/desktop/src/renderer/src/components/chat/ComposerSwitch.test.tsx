/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  const measureStage = () => vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'composer-slot') return parseFloat(this.style.height) || 0
    return Number(this.querySelector('[data-measured-height]')?.getAttribute('data-measured-height') ?? 0)
  })

  it('keeps the baseline slot while tall composers leave and enter above it', () => {
    stubMotion(false)
    measureStage()
    const preview = (kind: 'short' | 'tall') => <ComposerSwitch kind={kind}
      align={{ kind: 'tall', to: 'short' }}
      render={shown => <div data-measured-height={shown === 'short' ? 80 : 240} />} />
    const { rerender } = render(preview('short'))
    const slot = screen.getByTestId('composer-slot')
    const stage = screen.getByTestId('composer-switch')
    expect(slot.style.height).toBe('80px')
    expect(stage).toHaveClass('absolute', 'bottom-0')
    rerender(preview('tall'))
    endAnimation(stage)
    expect(slot.style.height).toBe('80px')
    endAnimation(stage)
    rerender(preview('short'))
    expect(slot.style.height).toBe('80px')
    endAnimation(stage)
    expect(slot.style.height).toBe('80px')
    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'steady')
    expect(slot.style.height).toBe('80px')
    expect(slot.className).not.toContain('transition-[height]')
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
    // Only the baseline occupies layout; the outgoing stage slides over history.
    expect(screen.getByTestId('composer-slot').style.height).not.toBe('')

    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'entering')
    expect(screen.getByTestId('text-composer')).toBeInTheDocument()
    expect(screen.queryByTestId('voice-composer')).toBeNull()
    // Entrance does not resize the baseline either.
    expect(screen.getByTestId('composer-slot').style.height).not.toBe('')

    // Entrance completes directly, without a height-settling phase.
    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'steady')
    expect(screen.getByTestId('composer-slot').style.height).not.toBe('')
  })

  it('clips only the bottom during a handoff so landing-page content above the composer does not blink', () => {
    stubMotion(false)
    const { rerender } = render(render_('text'))
    // At rest the text composer's popups (@ / todo) hang above the slot, so it must not clip.
    expect(screen.getByTestId('composer-slot')).not.toHaveClass('overflow-hidden')


    rerender(render_('voice'))
    expect(screen.getByTestId('composer-slot')).not.toHaveClass('overflow-hidden')
    expect(screen.getByTestId('composer-slot').style.clipPath).toBe('inset(-100vh 0 0)')

    const stage = screen.getByTestId('composer-switch')
    endAnimation(stage)
    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'steady')
    expect(screen.getByTestId('composer-slot')).not.toHaveClass('overflow-hidden')
    expect(screen.getByTestId('composer-slot').style.clipPath).toBe('')
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
    act(() => notify())
    expect(onOverhangChange).toHaveBeenLastCalledWith(0)
    rerender(slot('tall'))
    const stage = screen.getByTestId('composer-switch')
    endAnimation(stage)
    endAnimation(stage)
    act(() => notify())
    expect(onOverhangChange).toHaveBeenLastCalledWith(160)
    rerender(slot('short'))
    endAnimation(stage)
    endAnimation(stage)
    endAnimation(stage)
    act(() => notify())
    expect(onOverhangChange).toHaveBeenLastCalledWith(0)
    // The base composer growing with its draft, without a render, counts too.
    const draft = stage.querySelector('[data-measured-height]')!
    draft.setAttribute('data-measured-height', '120')
    act(() => notify())
    expect(onOverhangChange).toHaveBeenLastCalledWith(40)
    draft.setAttribute('data-measured-height', '80')
    act(() => notify())
    expect(onOverhangChange).toHaveBeenLastCalledWith(0)
    unmount()
    expect(onOverhangChange).toHaveBeenLastCalledWith(0)
    vi.unstubAllGlobals()
  })

  it('preserves the baseline while a pane is hidden', () => {
    measureStage()
    let resize = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { resize = cb }
      observe() {}
      disconnect() {}
    })
    render(<ComposerSwitch kind="text" render={() => <div data-measured-height="80" />} />)
    const slot = screen.getByTestId('composer-slot')
    expect(slot.style.height).toBe('80px')
    screen.getByTestId('composer-switch').firstElementChild!.setAttribute('data-measured-height', '0')
    act(() => resize())
    expect(slot.style.height).toBe('80px')
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
    expect(screen.getByTestId('composer-switch').style.maxHeight).toBe('440px')
    expect(screen.getByTestId('composer-slot').style.maxHeight).toBe('')
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
    expect(slot.style.maxHeight).toBe('')
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
