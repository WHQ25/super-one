/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import { canAutofocusInChatRoot, isFocusInChat } from './is-focus-in-chat'

describe('isFocusInChat', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns true when focus is inside [data-chat-root]', () => {
    const root = document.createElement('div')
    root.setAttribute('data-chat-root', '')
    const input = document.createElement('input')
    root.appendChild(input)
    document.body.appendChild(root)
    input.focus()

    expect(isFocusInChat(input)).toBe(true)
    expect(isFocusInChat()).toBe(true)
  })

  it('returns false when focus is outside chat', () => {
    const chat = document.createElement('div')
    chat.setAttribute('data-chat-root', '')
    document.body.appendChild(chat)

    const panel = document.createElement('div')
    const input = document.createElement('input')
    panel.appendChild(input)
    document.body.appendChild(panel)
    input.focus()

    expect(isFocusInChat(input)).toBe(false)
    expect(isFocusInChat()).toBe(false)
  })

  it('returns false for body / null', () => {
    expect(isFocusInChat(document.body)).toBe(false)
    expect(isFocusInChat(null)).toBe(false)
  })

  it('scopes to a specific root when provided (mosaic isolation)', () => {
    const rootA = document.createElement('div')
    rootA.setAttribute('data-chat-root', '')
    const inputA = document.createElement('input')
    rootA.appendChild(inputA)

    const rootB = document.createElement('div')
    rootB.setAttribute('data-chat-root', '')
    const inputB = document.createElement('input')
    rootB.appendChild(inputB)

    document.body.appendChild(rootA)
    document.body.appendChild(rootB)
    inputA.focus()

    expect(isFocusInChat(inputA, rootA)).toBe(true)
    expect(isFocusInChat(inputA, rootB)).toBe(false)
    // Unscoped still true for any chat root
    expect(isFocusInChat(inputA)).toBe(true)
  })
})

describe('canAutofocusInChatRoot', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('allows autofocus when focus is outside every chat root', () => {
    const root = document.createElement('div')
    root.setAttribute('data-chat-root', '')
    document.body.appendChild(root)
    document.body.focus?.()
    // jsdom: body may not take focus; use an outside input
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    outside.focus()

    expect(canAutofocusInChatRoot(root, outside)).toBe(true)
    expect(canAutofocusInChatRoot(root, null)).toBe(true)
  })

  it('allows autofocus when focus is already in the same root', () => {
    const root = document.createElement('div')
    root.setAttribute('data-chat-root', '')
    const input = document.createElement('input')
    root.appendChild(input)
    document.body.appendChild(root)
    input.focus()

    expect(canAutofocusInChatRoot(root, input)).toBe(true)
  })

  it('blocks autofocus when focus is in a sibling chat root', () => {
    const rootA = document.createElement('div')
    rootA.setAttribute('data-chat-root', '')
    const inputA = document.createElement('input')
    rootA.appendChild(inputA)

    const rootB = document.createElement('div')
    rootB.setAttribute('data-chat-root', '')

    document.body.appendChild(rootA)
    document.body.appendChild(rootB)
    inputA.focus()

    expect(canAutofocusInChatRoot(rootB, inputA)).toBe(false)
    expect(canAutofocusInChatRoot(rootA, inputA)).toBe(true)
  })
})
