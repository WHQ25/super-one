// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pressModHotkey } from './ModTree'

afterEach(() => vi.useRealTimers())

describe('pressModHotkey', () => {
  it('clicks the control and draws it pressed for a moment', () => {
    vi.useFakeTimers()
    const button = document.createElement('button')
    const onClick = vi.fn()
    button.addEventListener('click', onClick)
    pressModHotkey(button)
    expect(onClick).toHaveBeenCalledOnce()
    expect(button.hasAttribute('data-pressed')).toBe(true)
    vi.advanceTimersByTime(250)
    expect(button.hasAttribute('data-pressed')).toBe(false)
  })
})
