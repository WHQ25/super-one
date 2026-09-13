import { describe, expect, it } from 'vitest'
import { collectGeneratedImages, getToolVerb, isHiddenToolBlock } from './tool-display'
import type { ContentBlock } from '@superone/shared/agent-types'

describe('getToolVerb', () => {
  it('uses the same live Bash label as the desktop terminal row', () => {
    expect(getToolVerb('Bash')).toBe('Running')
  })

  it('treats Grok qualified MCP names as Running, same as mcp__ rows', () => {
    expect(getToolVerb('mcp__GitHub__list_issues')).toBe('Running')
    expect(getToolVerb('GitHub__list_issues')).toBe('Running')
  })
})

describe('native widget_show results — hide/collect contract', () => {
  const tool = 'mcp__superone__widget_show'
  const gallery = JSON.stringify({
    kind: 'native', nativeType: 'image-gallery', title: 'g',
    images: [{ id: 'g-0', type: 'image_generation', status: 'completed', savedPath: '/tmp/a.png' }],
  })
  const previewer = JSON.stringify({
    kind: 'native', nativeType: 'files-previewer', title: 'p', root: '/repo',
    files: [{ path: 'a.png', absolutePath: '/repo/a.png', name: 'a.png', kind: 'image' }],
  })
  const call = (id: string): ContentBlock => ({ type: 'tool_use', toolUseId: id, toolName: tool, input: '{}' })

  it('hides a gallery result (the turn-end gallery shows it) but keeps a previewer row (it renders in place)', () => {
    expect(isHiddenToolBlock(tool, gallery)).toBe(true)
    expect(isHiddenToolBlock(tool, previewer)).toBe(false)
  })

  it('collects gallery items at turn end and ignores a previewer, so the block is never drawn twice', () => {
    const results = new Map([['g', gallery], ['p', previewer]])
    const items = collectGeneratedImages([call('g'), call('p')], results)
    expect(items.map((i) => i.savedPath)).toEqual(['/tmp/a.png'])
  })
})
