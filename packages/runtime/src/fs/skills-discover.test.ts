import { describe, expect, it } from 'vitest'
import {
  parseSimpleFrontmatter,
  resolveArgumentHint,
  readArgumentHintFromMarkdownFile,
} from './skills-discover'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('resolveArgumentHint', () => {
  it('reads Claude arguments key', () => {
    expect(resolveArgumentHint({ arguments: '[a] [b]' })).toBe('[a] [b]')
  })

  it('reads Grok argument-hint key', () => {
    expect(resolveArgumentHint({ 'argument-hint': '<query>' })).toBe('<query>')
  })

  it('prefers arguments over argument-hint when both set', () => {
    expect(resolveArgumentHint({
      arguments: 'from-arguments',
      'argument-hint': 'from-hint',
    })).toBe('from-arguments')
  })

  it('falls back to argument-hint when arguments is empty', () => {
    expect(resolveArgumentHint({
      arguments: '  ',
      'argument-hint': 'from-hint',
    })).toBe('from-hint')
  })

  it('returns empty for missing/null frontmatter', () => {
    expect(resolveArgumentHint(undefined)).toBe('')
    expect(resolveArgumentHint(null)).toBe('')
    expect(resolveArgumentHint({})).toBe('')
  })
})

describe('parseSimpleFrontmatter + resolveArgumentHint', () => {
  it('strips quotes around arguments', () => {
    const fm = parseSimpleFrontmatter(
      '---\narguments: "[alpha|beta]"\nargument-hint: plain\n---\nbody\n',
    )
    expect(resolveArgumentHint(fm)).toBe('[alpha|beta]')
  })
})

describe('readArgumentHintFromMarkdownFile', () => {
  it('reads either frontmatter key from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-arg-'))
    try {
      const withArgs = join(dir, 'args.md')
      writeFileSync(withArgs, '---\narguments: env\n---\n', 'utf8')
      expect(readArgumentHintFromMarkdownFile(withArgs)).toBe('env')

      const withHint = join(dir, 'hint.md')
      writeFileSync(withHint, '---\nargument-hint: q\n---\n', 'utf8')
      expect(readArgumentHintFromMarkdownFile(withHint)).toBe('q')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
