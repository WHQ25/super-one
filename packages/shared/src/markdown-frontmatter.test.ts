import { describe, expect, it } from 'vitest'
import { frontmatterAsCodeBlock, splitFrontmatter } from './markdown-frontmatter'

describe('splitFrontmatter', () => {
  it('parses yaml frontmatter', () => {
    const r = splitFrontmatter('---\ntitle: Hi\n---\n# Body')
    expect(r.frontmatter).toBe('title: Hi')
    expect(r.body).toBe('# Body')
  })

  it('returns null when no frontmatter', () => {
    expect(splitFrontmatter('# Title').frontmatter).toBeNull()
  })

  it('does not match mid-document hr', () => {
    expect(splitFrontmatter('# Title\n---\nfoo').frontmatter).toBeNull()
  })
})

describe('frontmatterAsCodeBlock', () => {
  it('fences the frontmatter as yaml above the body', () => {
    expect(frontmatterAsCodeBlock('---\ntitle: Hi\n---\n# Body')).toBe('```yaml\ntitle: Hi\n```\n\n# Body')
  })

  it('leaves a document without frontmatter unchanged', () => {
    expect(frontmatterAsCodeBlock('# Title\n---\nfoo')).toBe('# Title\n---\nfoo')
  })

  it('uses a fence longer than any backtick run inside', () => {
    expect(frontmatterAsCodeBlock('---\nnote: "````"\n---\nbody')).toBe('`````yaml\nnote: "````"\n`````\n\nbody')
  })
})
