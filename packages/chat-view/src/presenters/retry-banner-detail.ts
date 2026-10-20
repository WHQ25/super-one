/** Banner suffix. Short clauses stay; a Grok API dump stays on the tooltip only. */
const RETRY_DETAIL_LIMIT = 80

export function visibleRetryDetail(message: string | undefined): string | undefined {
  const text = message?.replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  if (text.length > RETRY_DETAIL_LIMIT) return undefined
  if (text.includes('{') || /^API error\b/i.test(text)) return undefined
  return text
}
