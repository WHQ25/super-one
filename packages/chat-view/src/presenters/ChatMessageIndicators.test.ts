import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { initializeChatViewI18n } from '../i18n'
import {
  ApiRetryIndicator,
  RecappingIndicator,
  TurnMetaIndicator,
  TurnSummaryAboveFooter,
} from './ChatMessageIndicators'
import { visibleRetryDetail } from './retry-banner-detail'

beforeAll(async () => {
  await initializeChatViewI18n('en')
})

const grokDump = 'API error (status 500 Internal Server Error): {"error":"upstream exploded","request_id":"req_123","model":"grok-4"}'

describe('visibleRetryDetail', () => {
  it('keeps a short clause and drops an API dump', () => {
    expect(visibleRetryDetail('timeout')).toBe('timeout')
    expect(visibleRetryDetail('  rate limited  ')).toBe('rate limited')
    expect(visibleRetryDetail(grokDump)).toBeUndefined()
    expect(visibleRetryDetail('API error (status 504): upstream timeout')).toBeUndefined()
    expect(visibleRetryDetail(undefined)).toBeUndefined()
    expect(visibleRetryDetail('   ')).toBeUndefined()
  })
})

function withoutTitle(html: string): string {
  return html.replace(/\stitle="[^"]*"/g, '')
}

describe('ApiRetryIndicator', () => {
  it('shows the retry count without the upstream dump', () => {
    const html = renderToStaticMarkup(createElement(ApiRetryIndicator, {
      info: { attempt: 2, maxRetries: 5, delayMs: 0, phase: 'retrying', message: grokDump },
    }))
    const visible = withoutTitle(html)
    expect(visible).toContain('Retrying API request (2/5)…')
    expect(visible).not.toContain('—')
    expect(visible).not.toContain('upstream exploded')
    expect(html).toContain('upstream exploded')
  })

  it('keeps a short retry reason on the banner', () => {
    const html = renderToStaticMarkup(createElement(ApiRetryIndicator, {
      info: { attempt: 1, delayMs: 0, message: 'timeout' },
    }))
    expect(html).toContain('Retrying API request (1)… — timeout')
  })

  it('hides a dump after retries are exhausted', () => {
    const html = renderToStaticMarkup(createElement(ApiRetryIndicator, {
      info: { attempt: 5, delayMs: 0, phase: 'exhausted', message: grokDump },
    }))
    const visible = withoutTitle(html)
    expect(visible).toContain('API retries exhausted')
    expect(visible).not.toContain('—')
    expect(visible).not.toContain('upstream exploded')
  })
})

describe('turn meta chrome', () => {
  it('labels a recap with Recap:', () => {
    const html = renderToStaticMarkup(createElement(TurnMetaIndicator, {
      meta: { kind: 'recap', text: 'Picked up the parity audit', auto: true },
    }))
    expect(html).toContain('Recap:')
    expect(html).toContain('Picked up the parity audit')
    expect(html).toContain('data-turn-meta="recap"')
    expect(html).not.toContain('Summary:')
  })

  it('labels a standalone summary marker with Summary:', () => {
    const html = renderToStaticMarkup(createElement(TurnMetaIndicator, {
      meta: { kind: 'summary', text: 'Moved the field under the notch' },
    }))
    expect(html).toContain('Summary:')
    expect(html).toContain('Moved the field under the notch')
    expect(html).toContain('data-turn-meta="summary"')
  })

  it('labels the footer summary with the same Summary: prefix', () => {
    const html = renderToStaticMarkup(createElement(TurnSummaryAboveFooter, {
      summary: '  Tool args arrive as one packet  ',
    }))
    expect(html).toContain('Summary:')
    expect(html).toContain('Tool args arrive as one packet')
  })

  it('hides an empty footer summary instead of a bare label', () => {
    const html = renderToStaticMarkup(createElement(TurnSummaryAboveFooter, { summary: '   ' }))
    expect(html).toBe('')
  })

  it('announces a pending recap without a Recap: body', () => {
    const html = renderToStaticMarkup(createElement(RecappingIndicator))
    expect(html).toContain('Generating recap…')
    expect(html).toContain('data-turn-meta="recap-pending"')
    expect(html).not.toContain('Recap:')
  })

  it('uses the Chinese prefixes when the view locale is zh', async () => {
    await initializeChatViewI18n('zh')
    try {
      const summary = renderToStaticMarkup(createElement(TurnSummaryAboveFooter, {
        summary: '参数一次发完',
      }))
      const recap = renderToStaticMarkup(createElement(TurnMetaIndicator, {
        meta: { kind: 'recap', text: '离开期间对齐了流式边界' },
      }))
      expect(summary).toContain('小结：')
      expect(recap).toContain('回顾：')
    } finally {
      await initializeChatViewI18n('en')
    }
  })
})
