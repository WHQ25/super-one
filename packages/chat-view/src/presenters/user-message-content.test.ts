import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { UserMessageContentPresenter } from './UserMessageContent'

const Block = () => null

function bubble(content: ChatMessage['content']): string {
  const message: ChatMessage = { id: 'u1', role: 'user', status: 'complete', createdAt: '', providerId: 'user', content }
  return renderToStaticMarkup(createElement(UserMessageContentPresenter, { message, promptKeywords: ['ultracode'], Block }))
}

/** How many `ultracode` keywords are painted (one span per letter). */
const painted = (html: string) => (html.match(/class="prompt-keyword-ultracode"/g) ?? []).length / 'ultracode'.length

describe('prompt keywords across a user message', () => {
  it('rules a quote that spans an attachment as the composer did', () => {
    const html = bubble([
      { type: 'text', text: 'ultracode discuss "ultracode' },
      { type: 'image', name: 'shot.png' },
      { type: 'text', text: '"' },
    ])
    expect(painted(html)).toBe(1)
  })

  it('still paints every keyword outside quotes, in any block', () => {
    const html = bubble([
      { type: 'text', text: 'ultracode first' },
      { type: 'image', name: 'shot.png' },
      { type: 'text', text: 'then ultracode again' },
    ])
    expect(painted(html)).toBe(2)
  })
})
