/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import { isFocusInChat } from './is-focus-in-chat'

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
})
