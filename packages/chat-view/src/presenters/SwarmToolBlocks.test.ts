import { describe, expect, it } from 'vitest'
import {
  postMessageSummaryText,
  readBoardSummaryText,
  swarmWaitSummaryText,
} from './SwarmToolBlocks'

describe('SwarmToolBlocks summaries', () => {
  it('formats read_board summary from result and params', () => {
    expect(
      readBoardSummaryText(
        { since: 3 },
        JSON.stringify({ messages: [{ seq: 4, agent: 'researcher', text: 'hi' }, { seq: 5, agent: 'reviewer', text: 'ok' }], head: 5 }),
      ),
    ).toBe('2 messages · head #5')
    expect(readBoardSummaryText({ channel: 'parser', since: 2 })).toBe('#parser · since #2')
  })

  it('formats post_message summary with seq and preview', () => {
    expect(
      postMessageSummaryText(
        { text: '@reviewer Please verify\nline 2' },
        JSON.stringify({ status: 'posted', seq: 6 }),
      ),
    ).toBe('#6 · @reviewer Please verify')
  })

  it('formats swarm_wait summary', () => {
    expect(swarmWaitSummaryText({ since: 5, mentions_only: false })).toBe('since #5 · all posts')
  })
})
