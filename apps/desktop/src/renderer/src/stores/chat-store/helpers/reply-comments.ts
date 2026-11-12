/** A sticky-note comment the user pinned to a passage of the transcript, or to code. */
export interface ReplyComment {
  id: string
  /** `data-message-id` of the transcript row the passage starts in; null outside any row. */
  messageId: string | null
  /** The passage's raw text (its text nodes concatenated), to find it again. */
  anchorText: string
  /** The passage as "Add to Chat" quotes it (a reply's Markdown, or a file/diff quote). */
  quote: string
  text: string
  /**
   * Absent for a transcript passage. `code` is a file selection or diff hunk:
   * it shares this list's numbers and is not painted on the transcript.
   */
  surface?: 'code'
}

export function newReplyCommentId(): string {
  return `reply-comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function quoteLines(quote: string): string {
  return quote.split('\n').map((line) => `> ${line}`).join('\n')
}

/** The block the agent reads for the comments sent with a turn; empty when none. */
export function buildReplyCommentsText(comments: readonly ReplyComment[]): string {
  if (comments.length === 0) return ''
  const items = comments.map((c, i) => `${i + 1}. On this passage:\n${quoteLines(c.quote)}\nComment: ${c.text}`)
  return [
    '<reply_comments>',
    'The user commented on passages of this conversation:',
    '',
    items.join('\n\n'),
    '</reply_comments>',
  ].join('\n')
}

/** How a sent comment shows among the message's quoted selections: comment first, so a lone chip previews it. */
export function replyCommentSelection(comment: ReplyComment): string {
  return `${comment.text}\n\n${quoteLines(comment.quote)}`
}
