/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeviceInput } from './use-device-input'

const deviceInput = vi.fn(async () => ({ ok: true }))

beforeEach(() => {
  deviceInput.mockClear()
  Object.defineProperty(window, 'environment', {
    configurable: true,
    value: { deviceInput },
  })
})

function mountKeyboard() {
  const { result } = renderHook(() => useDeviceInput({
    sessionId: 'session-a',
    enabled: true,
    canvas: null,
  }))
  const box = document.createElement('textarea')
  return { handlers: result.current.keyboard.handlers, box }
}

describe('useDeviceInput keyboard', () => {
  it('leaves the pre-edit alone while an IME is composing', () => {
    const { handlers, box } = mountKeyboard()

    handlers.onCompositionStart({} as never)
    // Chromium fires one of these per keystroke of a composition; the box holds the
    // pinyin the user is still choosing characters for.
    box.value = 'nihao'
    handlers.onInput({
      currentTarget: box,
      nativeEvent: { inputType: 'insertCompositionText', data: 'nihao' },
    } as never)

    expect(box.value).toBe('nihao')
    expect(deviceInput).not.toHaveBeenCalled()
  })

  it('sends the committed string once and empties the box', () => {
    const { handlers, box } = mountKeyboard()

    handlers.onCompositionStart({} as never)
    box.value = '你好'
    handlers.onCompositionEnd({ currentTarget: box, data: '你好' } as never)

    expect(deviceInput).toHaveBeenCalledTimes(1)
    expect(deviceInput).toHaveBeenCalledWith('session-a', { type: 'text', text: '你好' })
    expect(box.value).toBe('')
  })

  it('forwards a typed character from the input event, not the keystroke', () => {
    const { handlers, box } = mountKeyboard()
    const preventDefault = vi.fn()

    // The keystroke that starts a composition looks exactly like this one, so
    // nothing may be sent — or prevented — while it is all we know.
    handlers.onKeyDown({
      key: 'a', nativeEvent: { isComposing: false }, preventDefault,
    } as never)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(deviceInput).not.toHaveBeenCalled()

    box.value = 'a'
    handlers.onInput({
      currentTarget: box,
      nativeEvent: { inputType: 'insertText', data: 'a' },
    } as never)

    expect(deviceInput).toHaveBeenCalledExactlyOnceWith('session-a', { type: 'text', text: 'a' })
    expect(box.value).toBe('')
  })

  it('does not forward the composed text a second time from the input event', () => {
    const { handlers, box } = mountKeyboard()

    handlers.onCompositionStart({} as never)
    box.value = '你好'
    handlers.onCompositionEnd({ currentTarget: box, data: '你好' } as never)
    // Chromium can raise this after `compositionend`; it must not resend.
    handlers.onInput({
      currentTarget: box,
      nativeEvent: { inputType: 'insertFromComposition', data: '你好' },
    } as never)

    expect(deviceInput).toHaveBeenCalledExactlyOnceWith('session-a', { type: 'text', text: '你好' })
    expect(box.value).toBe('')
  })

  it('sends keys that carry no text of their own from the keystroke', () => {
    const { handlers } = mountKeyboard()
    const preventDefault = vi.fn()

    handlers.onKeyDown({
      key: 'Enter', nativeEvent: { isComposing: false }, preventDefault,
    } as never)

    expect(preventDefault).toHaveBeenCalled()
    expect(deviceInput).toHaveBeenCalledExactlyOnceWith('session-a', { type: 'text', text: '\n' })
  })

  it('drops keystrokes that belong to the IME', () => {
    const { handlers } = mountKeyboard()
    const preventDefault = vi.fn()

    handlers.onKeyDown({
      key: 'n', nativeEvent: { isComposing: true }, preventDefault,
    } as never)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(deviceInput).not.toHaveBeenCalled()
  })
})
