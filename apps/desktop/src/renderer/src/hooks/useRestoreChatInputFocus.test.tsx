/** @vitest-environment jsdom */

import { createRef } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { requestChatInputFocusRestore } = vi.hoisted(() => ({ requestChatInputFocusRestore: vi.fn() }))

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: { requestChatInputFocusRestore: typeof requestChatInputFocusRestore }) => unknown) =>
    selector({ requestChatInputFocusRestore }),
}))

import { useRestoreChatInputFocus } from './useRestoreChatInputFocus'

afterEach(() => {
  requestChatInputFocusRestore.mockClear()
  document.body.innerHTML = ''
})

describe('useRestoreChatInputFocus', () => {
  it('restores focus only when the decision replaced a focused editor', () => {
    const root = document.createElement('div')
    root.setAttribute('data-chat-root', '')
    const editor = document.createElement('div')
    editor.setAttribute('data-chat-input-editor', 'true')
    editor.tabIndex = 0
    root.append(editor)
    document.body.append(root)
    editor.focus()
    const rootRef = createRef<HTMLElement>()
    rootRef.current = root

    const { result, rerender } = renderHook(({ active }) => useRestoreChatInputFocus(active, rootRef), {
      initialProps: { active: false },
    })
    act(() => rerender({ active: true }))
    expect(result.current.autoFocusOnMount).toBe(false)
    act(() => rerender({ active: false }))
    expect(requestChatInputFocusRestore).not.toHaveBeenCalled()
    act(() => result.current.onBaseComposerMounted())
    expect(requestChatInputFocusRestore).toHaveBeenCalledTimes(1)
    expect(result.current.autoFocusOnMount).toBe(true)
  })

  it('restores the owning pane and discards restoration after a session switch', () => {
    const root = document.createElement('div')
    const editor = document.createElement('div')
    editor.setAttribute('data-chat-input-editor', 'true')
    editor.tabIndex = 0
    root.append(editor)
    document.body.append(root)
    editor.focus()
    const rootRef = createRef<HTMLElement>()
    rootRef.current = root
    const target = { projectPath: '/project', sessionId: 'side' }
    const { result, rerender } = renderHook(({ active, target }) => useRestoreChatInputFocus(active, rootRef, target), {
      initialProps: { active: false, target },
    })
    act(() => rerender({ active: true, target }))
    act(() => rerender({ active: false, target }))
    act(() => result.current.onBaseComposerMounted())
    expect(requestChatInputFocusRestore).toHaveBeenCalledWith(target)
    requestChatInputFocusRestore.mockClear()

    act(() => rerender({ active: true, target }))
    act(() => rerender({ active: false, target: { ...target, sessionId: 'another' } }))
    act(() => result.current.onBaseComposerMounted())
    expect(requestChatInputFocusRestore).not.toHaveBeenCalled()
  })

  it('does not request editor focus when focus was elsewhere before the prompt', () => {
    const root = document.createElement('div')
    root.setAttribute('data-chat-root', '')
    const editor = document.createElement('div')
    editor.setAttribute('data-chat-input-editor', 'true')
    const other = document.createElement('button')
    other.textContent = 'other'
    root.append(editor, other)
    document.body.append(root)
    other.focus()
    const rootRef = createRef<HTMLElement>()
    rootRef.current = root

    const { rerender } = renderHook(({ active }) => useRestoreChatInputFocus(active, rootRef), {
      initialProps: { active: false },
    })
    act(() => rerender({ active: true }))
    act(() => rerender({ active: false }))

    expect(requestChatInputFocusRestore).not.toHaveBeenCalled()
  })

  it('restores focus after a full-screen plan removes the editor before the transition effect', () => {
    const root = document.createElement('div')
    const editor = document.createElement('div')
    editor.setAttribute('data-chat-input-editor', 'true')
    editor.tabIndex = 0
    root.append(editor)
    document.body.append(root)
    const rootRef = createRef<HTMLElement>()
    rootRef.current = root
    const { result, rerender } = renderHook(({ active }) => useRestoreChatInputFocus(active, rootRef), {
      initialProps: { active: false },
    })
    editor.focus()
    editor.remove()
    act(() => rerender({ active: true }))
    act(() => rerender({ active: false }))
    act(() => result.current.onBaseComposerMounted())
    expect(requestChatInputFocusRestore).toHaveBeenCalledTimes(1)
  })
})
