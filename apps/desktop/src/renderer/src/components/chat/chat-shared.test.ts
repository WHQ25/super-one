import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/path-utils', () => ({
  toMediaUrl: (p: string) => `media://${p}`,
  toLocalFileUrl: (p: string) => `local-file://${p}`,
}))

vi.mock('streamdown', () => ({
  defaultRehypePlugins: {},
}))

vi.mock('hast-util-sanitize', () => ({
  defaultSchema: { tagNames: [], attributes: {}, protocols: {} },
}))

vi.mock('rehype-sanitize', () => ({ default: () => {} }))
vi.mock('@streamdown/code', () => ({ createCodePlugin: () => ({}) }))
vi.mock('@streamdown/math', () => ({ createMathPlugin: () => ({ rehypePlugin: [{}, {}] }) }))
vi.mock('katex/dist/katex.min.css', () => ({}))
vi.mock('./CodeBlock', () => ({ createStreamdownCodeComponent: () => ({}) }))
vi.mock('./LinkSafetyModal', () => ({ LinkSafetyModal: () => null }))
vi.mock('./markdown-image', () => ({ MarkdownImage: () => null }))

import { resolveMarkdownMedia, resolveMarkdownFileLinks, resolveMarkdownLocalRefs, formatTokens } from './chat-shared'

describe('formatTokens', () => {
  it('should return "0" for 0', () => {
    expect(formatTokens(0)).toBe('0')
  })

  it('should return plain number below 1000', () => {
    expect(formatTokens(1)).toBe('1')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(500)).toBe('500')
  })

  it('should format 1000 as 1.0k', () => {
    expect(formatTokens(1000)).toBe('1.0k')
  })

  it('should format 1500 as 1.5k', () => {
    expect(formatTokens(1500)).toBe('1.5k')
  })

  it('should format 10000 as 10.0k', () => {
    expect(formatTokens(10000)).toBe('10.0k')
  })

  it('should format 999999 as 1000.0k', () => {
    expect(formatTokens(999999)).toBe('1000.0k')
  })

  it('should format 1000000 as 1.0m (not 1000.0k)', () => {
    expect(formatTokens(1_000_000)).toBe('1.0m')
  })

  it('should format multi-million with one decimal m', () => {
    expect(formatTokens(1_500_000)).toBe('1.5m')
    expect(formatTokens(12_300_000)).toBe('12.3m')
  })

  it('should return negative numbers as plain string below 1000', () => {
    expect(formatTokens(-1)).toBe('-1')
    expect(formatTokens(-999)).toBe('-999')
  })
})

describe('resolveMarkdownMedia', () => {
  const project = '/Users/foo/project'

  it('should resolve relative image path', () => {
    const input = '![alt](./image.png)'
    const result = resolveMarkdownMedia(input, project)
    expect(result).toBe('![alt](local-file:///Users/foo/project/image.png)')
  })

  it('should resolve remote project images to remote-media refs', () => {
    const remote = 'remote:conn-1:/Users/foo/project'
    const result = resolveMarkdownMedia('![alt](./shot.png)', remote)
    expect(result.startsWith('![alt](remote-media://ref/')).toBe(true)
    expect(result.endsWith(')')).toBe(true)
  })

  it('should resolve relative image path without ./', () => {
    const input = '![alt](image.png)'
    const result = resolveMarkdownMedia(input, project)
    expect(result).toBe('![alt](local-file:///Users/foo/project/image.png)')
  })

  it('should resolve absolute image path', () => {
    const input = '![alt](/Users/bar/image.png)'
    const result = resolveMarkdownMedia(input, project)
    expect(result).toBe('![alt](local-file:///Users/bar/image.png)')
  })

  it('should not modify https URLs', () => {
    const input = '![alt](https://example.com/img.png)'
    expect(resolveMarkdownMedia(input, project)).toBe(input)
  })

  it('should not modify data URLs', () => {
    const input = '![alt](data:image/png;base64,abc)'
    expect(resolveMarkdownMedia(input, project)).toBe(input)
  })

  it('should not modify already-resolved local-file URLs', () => {
    const input = '![alt](local-file:///Users/foo/image.png)'
    expect(resolveMarkdownMedia(input, project)).toBe(input)
  })

  it('should resolve various image extensions', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif']) {
      const input = `![img](./photo.${ext})`
      expect(resolveMarkdownMedia(input, project)).toBe(
        `![img](local-file:///Users/foo/project/photo.${ext})`,
      )
    }
  })

  it('should resolve video file in image syntax', () => {
    const input = '![vid](./clip.mp4)'
    expect(resolveMarkdownMedia(input, project)).toBe(
      '![vid](local-file:///Users/foo/project/clip.mp4)',
    )
  })

  it('should resolve audio file in image syntax', () => {
    const input = '![aud](./song.mp3)'
    expect(resolveMarkdownMedia(input, project)).toBe(
      '![aud](local-file:///Users/foo/project/song.mp3)',
    )
  })

  it('should not modify non-media markdown links', () => {
    const input = '[readme](./README.md)'
    expect(resolveMarkdownMedia(input, project)).toBe(input)
  })

  it('should not modify media markdown links', () => {
    const input = '[photo](./photo.png)'
    expect(resolveMarkdownMedia(input, project)).toBe(input)
  })

  it('should handle mixed content with multiple images', () => {
    const input = 'Hello ![a](./a.png) world ![b](/tmp/b.jpg) end'
    const result = resolveMarkdownMedia(input, project)
    expect(result).toBe(
      'Hello ![a](local-file:///Users/foo/project/a.png) world ![b](local-file:///tmp/b.jpg) end',
    )
  })

  it('should return text unchanged when no media references', () => {
    const input = 'Just some plain text with no images or links.'
    expect(resolveMarkdownMedia(input, project)).toBe(input)
  })

  it('should handle nested directory paths', () => {
    const input = '![img](./assets/images/photo.png)'
    expect(resolveMarkdownMedia(input, project)).toBe(
      '![img](local-file:///Users/foo/project/assets/images/photo.png)',
    )
  })

  it('should preserve title in image syntax', () => {
    const input = '![alt](./img.png "title")'
    const result = resolveMarkdownMedia(input, project)
    expect(result).toBe('![alt](local-file:///Users/foo/project/img.png "title")')
  })
})

describe('resolveMarkdownFileLinks', () => {
  const project = '/Users/foo/project'

  it('rewrites bare relative file links to absolute project paths', () => {
    const input = 'see [superone-mcp-server.ts](apps/desktop/src/main/mcp/superone-mcp-server.ts)'
    expect(resolveMarkdownFileLinks(input, project)).toBe(
      'see [superone-mcp-server.ts](/Users/foo/project/apps/desktop/src/main/mcp/superone-mcp-server.ts)',
    )
  })

  it('rewrites ./ relative file links', () => {
    expect(resolveMarkdownFileLinks('[x](./src/x.ts)', project)).toBe('[x](/Users/foo/project/src/x.ts)')
  })

  it('leaves absolute file links unchanged', () => {
    const input = '[x](/Users/foo/project/src/x.ts)'
    expect(resolveMarkdownFileLinks(input, project)).toBe(input)
  })

  it('leaves http links unchanged', () => {
    const input = '[docs](https://example.com/path)'
    expect(resolveMarkdownFileLinks(input, project)).toBe(input)
  })

  it('leaves scheme URLs unchanged', () => {
    expect(resolveMarkdownFileLinks('[x](javascript:alert(1))', project)).toBe('[x](javascript:alert(1))')
    expect(resolveMarkdownFileLinks('[x](mailto:a@b.com)', project)).toBe('[x](mailto:a@b.com)')
  })

  it('does not rewrite image syntax', () => {
    const input = '![alt](./image.png)'
    expect(resolveMarkdownFileLinks(input, project)).toBe(input)
  })

  it('preserves line anchors and titles', () => {
    expect(resolveMarkdownFileLinks('[x](src/x.ts#L10)', project)).toBe(
      '[x](/Users/foo/project/src/x.ts#L10)',
    )
    expect(resolveMarkdownFileLinks('[x](src/x.ts "title")', project)).toBe(
      '[x](/Users/foo/project/src/x.ts "title")',
    )
  })
})

describe('resolveMarkdownLocalRefs', () => {
  const project = '/Users/foo/project'

  it('resolves both file links and media', () => {
    const input = 'see [f](apps/a.ts) and ![i](./img.png)'
    expect(resolveMarkdownLocalRefs(input, project)).toBe(
      'see [f](/Users/foo/project/apps/a.ts) and ![i](local-file:///Users/foo/project/img.png)',
    )
  })
})
