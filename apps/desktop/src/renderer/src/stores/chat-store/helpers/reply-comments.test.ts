import { describe, expect, it } from 'vitest'
import { buildReplyCommentsText, replyCommentSelection } from './reply-comments'

const comment = (id: string, quote: string, text: string) => ({ id, messageId: 'm', anchorText: quote, quote, text })

describe('buildReplyCommentsText', () => {
  it('is empty without comments', () => {
    expect(buildReplyCommentsText([])).toBe('')
  })

  it('numbers each comment under its block-quoted passage', () => {
    expect(buildReplyCommentsText([
      comment('a', 'line one\nline two', 'clarify'),
      comment('b', 'other', 'drop this'),
    ])).toBe([
      '<reply_comments>',
      'The user commented on passages of this conversation:',
      '',
      '1. On this passage:',
      '> line one',
      '> line two',
      'Comment: clarify',
      '',
      '2. On this passage:',
      '> other',
      'Comment: drop this',
      '</reply_comments>',
    ].join('\n'))
  })

  it('numbers a code diff comment in the same sequence as transcript comments', () => {
    const text = buildReplyCommentsText([
      comment('a', 'passage', 'chat note'),
      { ...comment('b', 'src/a.ts:L2:D\n-old\n+new', 'diff note'), surface: 'code' },
    ])
    expect(text).toContain('1. On this passage:\n> passage\nComment: chat note')
    expect(text).toContain('2. On this passage:\n> src/a.ts:L2:D\n> -old\n> +new\nComment: diff note')
  })
})

describe('replyCommentSelection', () => {
  it('leads with the comment so a lone chip previews it', () => {
    expect(replyCommentSelection(comment('a', 'x\ny', 'note'))).toBe('note\n\n> x\n> y')
  })
})
