/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findTextRange } from './plan-annotation-dom'
import { onReplyCommentEditRequest, replyCommentAnchor, requestReplyCommentEdit } from './reply-comment-target'

function transcript(): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = `
    <div data-message-id="u1"><p id="user">user words here</p></div>
    <div data-message-id="a1">
      <div class="chat-md"><p id="reply">first reply paragraph</p></div>
      <div id="tool">tool output</div>
    </div>
    <p id="loose">outside any row</p>
    <div data-plan-sticky-ui><span id="pin">1</span></div>`
  document.body.append(root)
  return root
}

function select(start: [string, number], end: [string, number]): Selection {
  const text = (id: string) => document.getElementById(id)!.firstChild!
  const range = document.createRange()
  range.setStart(text(start[0]), start[1])
  range.setEnd(text(end[0]), end[1])
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

afterEach(() => { document.body.innerHTML = '' })

describe('replyCommentAnchor', () => {
  it('anchors any selected transcript text to the row it starts in', () => {
    const root = transcript()
    expect(replyCommentAnchor(select(['user', 0], ['user', 1]), root)).toEqual({ messageId: 'u1', anchorText: 'u' })
    expect(replyCommentAnchor(select(['tool', 0], ['tool', 4]), root)).toEqual({ messageId: 'a1', anchorText: 'tool' })
    expect(replyCommentAnchor(select(['loose', 0], ['loose', 7]), root)).toEqual({ messageId: null, anchorText: 'outside' })
  })

  it('spans rows with the raw text between, and leaves sticky UI out', () => {
    const root = transcript()
    expect(replyCommentAnchor(select(['user', 11], ['pin', 1]), root)).toEqual({
      messageId: 'u1',
      anchorText: expect.stringMatching(/^here[\s\S]*first reply paragraph[\s\S]*tool output[\s\S]*outside any row$/),
    })
  })

  it('drops an end resting at the start of the next node', () => {
    const root = transcript()
    expect(replyCommentAnchor(select(['reply', 6], ['tool', 0]), root)?.anchorText).toBe('reply paragraph')
  })

  it('anchors the prose around a video and leaves the playback clock out', () => {
    const root = transcript()
    const row = root.querySelector('[data-message-id="a1"]')!
    row.querySelector('.chat-md')!.insertAdjacentHTML('beforeend', `
      <span data-copy-text="![demo](/clips/demo.mp4)" style="display:flex">
        <span data-media-player-chrome id="clock">0:00 / 0:05</span>
      </span>
      <p id="after">After the clip.</p>`)
    const anchor = replyCommentAnchor(select(['reply', 0], ['after', 5]), root)
    expect(anchor?.anchorText).toContain('first reply paragraph')
    expect(anchor?.anchorText).toContain('After')
    expect(anchor?.anchorText).not.toContain('0:00')
    expect(findTextRange(root, anchor!.anchorText, row)).not.toBeNull()
  })

  it('is null without selected text in the transcript', () => {
    const root = transcript()
    expect(replyCommentAnchor(null, root)).toBeNull()
    expect(replyCommentAnchor(select(['pin', 0], ['pin', 1]), root)).toBeNull()
  })
})

describe('reply comment edit requests', () => {
  it('reach listeners until they unsubscribe', () => {
    const listener = vi.fn()
    const off = onReplyCommentEditRequest(listener)
    requestReplyCommentEdit('c1')
    off()
    requestReplyCommentEdit('c2')
    expect(listener.mock.calls).toEqual([['c1']])
  })
})
