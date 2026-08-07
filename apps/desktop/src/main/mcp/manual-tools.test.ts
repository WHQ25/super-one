import { describe, expect, it } from 'vitest'
import { WIDGET_GUIDELINE_MODULES } from '../generative-ui/guideline-modules'
import { MEDIA_GUIDE_TOPICS, MINIAPP_GUIDE_TOPICS, PRODUCT_GUIDE_TOPICS } from './superone-mcp-builtin-defs'
import { manualReadHandler, readMediaGuideHandler } from './manual-tools'

describe('manualReadHandler', () => {
  it('returns a catalog when domain is omitted', async () => {
    const result = await manualReadHandler({})
    const text = result.content[0].text
    expect(text).toMatch(/SuperOne manual/i)
    expect(text).toMatch(/product/)
    expect(text).toMatch(/miniapp/)
    expect(text).toMatch(/media/)
    expect(text).toMatch(/widget/)
    expect(text).toMatch(/config_read/)
  })

  it('returns product debug docs with runtime paths section', async () => {
    const result = await manualReadHandler({ domain: 'product', topic: 'debug' })
    const text = result.content[0].text
    expect(text).toMatch(/github\.com\/WHQ25\/super-one/)
    expect(text).toMatch(/main\.log/)
    expect(text).toMatch(/Runtime paths/)
  })

  it('returns product overview with repo link', async () => {
    const result = await manualReadHandler({ domain: 'product', topic: 'overview' })
    expect(result.content[0].text).toMatch(/github\.com\/WHQ25\/super-one/)
  })

  it('returns product contribute docs with issue-first and PR flow', async () => {
    const result = await manualReadHandler({ domain: 'product', topic: 'contribute' })
    const text = result.content[0].text
    expect(result.isError).not.toBe(true)
    expect(text).toMatch(/issue first/i)
    expect(text).toMatch(/Fixes #N/)
    expect(text).toMatch(/red.?green/i)
  })

  it('returns product collaboration docs for session_collab worktree recipes', async () => {
    const result = await manualReadHandler({ domain: 'product', topic: 'collaboration' })
    const text = result.content[0].text
    expect(result.isError).not.toBe(true)
    expect(text).toMatch(/worktree/i)
    expect(text).toMatch(/session_collab_request/)
    expect(text).toMatch(/~\/\.worktrees/)
  })

  it('lists collaboration in product domain index', async () => {
    const result = await manualReadHandler({ domain: 'product' })
    expect(result.content[0].text).toMatch(/collaboration/)
    for (const topic of PRODUCT_GUIDE_TOPICS) {
      expect(result.content[0].text).toContain(topic)
    }
  })

  it('lists miniapp topics for domain only', async () => {
    const result = await manualReadHandler({ domain: 'miniapp' })
    const text = result.content[0].text
    for (const topic of MINIAPP_GUIDE_TOPICS) {
      expect(text).toContain(topic)
    }
  })

  it('returns distinct miniapp guide content for every declared topic', async () => {
    const seen = new Set<string>()
    for (const topic of MINIAPP_GUIDE_TOPICS) {
      const result = await manualReadHandler({ domain: 'miniapp', topic })
      const text = result.content[0].text
      expect(result.isError, topic).not.toBe(true)
      expect(text.length, topic).toBeGreaterThan(0)
      expect(seen.has(text), topic).toBe(false)
      seen.add(text)
    }
  })

  it('returns media guide content for every declared topic', async () => {
    const seen = new Set<string>()
    for (const topic of MEDIA_GUIDE_TOPICS) {
      const result = await manualReadHandler({ domain: 'media', topic })
      const text = result.content[0].text
      expect(result.isError, topic).not.toBe(true)
      expect(text.length, topic).toBeGreaterThan(0)
      expect(seen.has(text), topic).toBe(false)
      seen.add(text)
    }
  })

  it('returns an MCP error for unknown domains and topics', async () => {
    const cases = [
      { domain: 'not-real' },
      ...PRODUCT_GUIDE_TOPICS.map(() => ({ domain: 'product', topic: 'not-real' })),
      { domain: 'miniapp', topic: 'not-real' },
      { domain: 'media', topic: 'not-real' },
      { domain: 'widget', topic: 'not-real' },
    ]
    for (const args of cases) {
      const result = await manualReadHandler(args)
      expect(result.isError, JSON.stringify(args)).toBe(true)
    }
  })

  it('rejects parameters that do not belong to the selected domain', async () => {
    const cases = [
      { topic: 'overview' },
      { modules: ['diagram'] },
      { domain: 'miniapp', modules: ['diagram'] },
      { domain: 'widget', topic: 'diagram', modules: ['chart'] },
      { domain: 'widget', modules: [] },
    ]
    for (const args of cases) {
      const result = await manualReadHandler(args)
      expect(result.isError, JSON.stringify(args)).toBe(true)
    }
  })

  it('returns every widget module without mixing in saved template state', async () => {
    for (const module of WIDGET_GUIDELINE_MODULES) {
      const result = await manualReadHandler({ domain: 'widget', modules: [module] })
      expect(result.isError, module).not.toBe(true)
      expect(result.content[0].text.length, module).toBeGreaterThan(0)
      expect(result.content[0].text, module).not.toMatch(/Saved templates/)
    }
  })
})

describe('readMediaGuideHandler (compat)', () => {
  it('throws on unknown topic', () => {
    expect(() => readMediaGuideHandler({ topic: 'not-a-real-topic' })).toThrow(/Unknown media guide topic/)
  })
})
