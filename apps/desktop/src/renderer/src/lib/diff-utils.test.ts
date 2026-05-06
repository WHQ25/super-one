vi.mock('@/components/chat/chat-shared', () => ({
  codePlugin: {},
  codePluginLight: {},
}))

import {
  inferLanguage,
  splitContentLines,
  buildUnifiedFileChangeDiffLines,
  buildFullFileWithDiff,
  reconstructOldContent,
  gutterWidth,
} from './diff-utils'

describe('inferLanguage', () => {
  it('should map common extensions correctly', () => {
    expect(inferLanguage('file.ts')).toBe('typescript')
    expect(inferLanguage('file.tsx')).toBe('tsx')
    expect(inferLanguage('file.js')).toBe('javascript')
    expect(inferLanguage('file.py')).toBe('python')
    expect(inferLanguage('file.rs')).toBe('rust')
    expect(inferLanguage('file.go')).toBe('go')
    expect(inferLanguage('file.md')).toBe('markdown')
    expect(inferLanguage('file.json')).toBe('json')
    expect(inferLanguage('file.css')).toBe('css')
    expect(inferLanguage('file.html')).toBe('html')
  })

  it('should return text for unknown extensions', () => {
    expect(inferLanguage('file.xyz')).toBe('text')
    expect(inferLanguage('file.unknown')).toBe('text')
  })

  it('should handle paths with multiple dots', () => {
    expect(inferLanguage('src/some.module.ts')).toBe('typescript')
    expect(inferLanguage('a.b.c.py')).toBe('python')
  })

  it('should handle special file names', () => {
    expect(inferLanguage('Dockerfile')).toBe('dockerfile')
    expect(inferLanguage('Makefile')).toBe('makefile')
  })
})

describe('splitContentLines', () => {
  it('should split by newline', () => {
    expect(splitContentLines('a\nb\nc')).toEqual(['a', 'b', 'c'])
  })

  it('should return empty array for empty string', () => {
    expect(splitContentLines('')).toEqual([])
  })

  it('should strip trailing newline', () => {
    expect(splitContentLines('a\nb\n')).toEqual(['a', 'b'])
  })

  it('should handle CRLF', () => {
    expect(splitContentLines('a\r\nb\r\nc')).toEqual(['a', 'b', 'c'])
  })
})

describe('buildUnifiedFileChangeDiffLines', () => {
  it('should parse unified diff with @@ headers', () => {
    const diff = '@@ -1,3 +1,3 @@\n context\n-old\n+new\n context2'
    const lines = buildUnifiedFileChangeDiffLines(diff)
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatchObject({ kind: 'unchanged', lineNum: 1, text: 'context' })
    expect(lines[1]).toMatchObject({ kind: 'removed', lineNum: 2, text: 'old' })
    expect(lines[2]).toMatchObject({ kind: 'added', lineNum: 2, text: 'new' })
    expect(lines[3]).toMatchObject({ kind: 'unchanged', lineNum: 3, text: 'context2' })
  })

  it('should assign correct line numbers to added/removed/context lines', () => {
    const diff = '@@ -5,4 +5,5 @@\n ctx\n-removed1\n-removed2\n+added1\n+added2\n+added3\n ctx'
    const lines = buildUnifiedFileChangeDiffLines(diff)
    expect(lines.find(l => l.text === 'ctx' && l.kind === 'unchanged')?.lineNum).toBe(5)
    expect(lines.find(l => l.text === 'removed1')?.lineNum).toBe(6)
    expect(lines.find(l => l.text === 'removed2')?.lineNum).toBe(7)
    expect(lines.find(l => l.text === 'added1')?.lineNum).toBe(6)
    expect(lines.find(l => l.text === 'added2')?.lineNum).toBe(7)
    expect(lines.find(l => l.text === 'added3')?.lineNum).toBe(8)
  })

  it('should handle multiple hunks', () => {
    const diff = '@@ -1,2 +1,2 @@\n-old1\n+new1\n ctx1\n@@ -10,2 +10,2 @@\n-old2\n+new2\n ctx2'
    const lines = buildUnifiedFileChangeDiffLines(diff)
    expect(lines).toHaveLength(6)
    expect(lines[0]).toMatchObject({ kind: 'removed', lineNum: 1, text: 'old1' })
    expect(lines[1]).toMatchObject({ kind: 'added', lineNum: 1, text: 'new1' })
    expect(lines[3]).toMatchObject({ kind: 'removed', lineNum: 10, text: 'old2' })
    expect(lines[4]).toMatchObject({ kind: 'added', lineNum: 10, text: 'new2' })
  })

  it('should return empty array for empty diff', () => {
    expect(buildUnifiedFileChangeDiffLines('')).toEqual([])
  })

  it('should skip lines before first hunk header', () => {
    const diff = '--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new'
    const lines = buildUnifiedFileChangeDiffLines(diff)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ kind: 'removed', text: 'old' })
    expect(lines[1]).toMatchObject({ kind: 'added', text: 'new' })
  })
})

describe('buildFullFileWithDiff', () => {
  it('should return all lines as unchanged when diff is empty', () => {
    const lines = buildFullFileWithDiff('line1\nline2\nline3', '')
    expect(lines).toHaveLength(3)
    expect(lines.every(l => l.kind === 'unchanged')).toBe(true)
    expect(lines.map(l => l.lineNum)).toEqual([1, 2, 3])
  })

  it('should merge full file content with unified diff', () => {
    const content = 'a\nb\nc\nd\ne'
    const diff = '@@ -2,3 +2,3 @@\n b\n-c\n+C\n d'
    const lines = buildFullFileWithDiff(content, diff)
    expect(lines.find(l => l.text === 'a')).toMatchObject({ kind: 'unchanged', lineNum: 1 })
    expect(lines.find(l => l.text === 'c')).toMatchObject({ kind: 'removed' })
    expect(lines.find(l => l.text === 'C')).toMatchObject({ kind: 'added' })
    expect(lines.find(l => l.text === 'e')).toMatchObject({ kind: 'unchanged', lineNum: 5 })
  })

  it('should show full file context outside diff hunks', () => {
    const content = 'first\nsecond\nthird\nfourth\nfifth'
    const diff = '@@ -3,1 +3,1 @@\n-third\n+THIRD'
    const lines = buildFullFileWithDiff(content, diff)
    expect(lines).toHaveLength(6)
    expect(lines[0]).toMatchObject({ kind: 'unchanged', text: 'first', lineNum: 1 })
    expect(lines[1]).toMatchObject({ kind: 'unchanged', text: 'second', lineNum: 2 })
    expect(lines[2]).toMatchObject({ kind: 'removed', text: 'third' })
    expect(lines[3]).toMatchObject({ kind: 'added', text: 'THIRD' })
    expect(lines[4]).toMatchObject({ kind: 'unchanged', text: 'fourth' })
    expect(lines[5]).toMatchObject({ kind: 'unchanged', text: 'fifth' })
  })

  it('should handle diff with no matching hunks', () => {
    const lines = buildFullFileWithDiff('a\nb', 'no hunk headers here')
    expect(lines).toHaveLength(2)
    expect(lines.every(l => l.kind === 'unchanged')).toBe(true)
  })
})

describe('reconstructOldContent', () => {
  it('returns the new content unchanged when diff is empty', () => {
    expect(reconstructOldContent('a\nb\nc', '')).toBe('a\nb\nc')
  })

  it('returns the new content unchanged when diff has no hunks', () => {
    expect(reconstructOldContent('a\nb', 'no hunks here')).toBe('a\nb')
  })

  it('reverses a simple replacement', () => {
    const newContent = 'a\nB\nc'
    const diff = '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c'
    expect(reconstructOldContent(newContent, diff)).toBe('a\nb\nc')
  })

  it('reverses a pure addition (drops added lines)', () => {
    const newContent = 'a\nb\nc\nd'
    const diff = '@@ -1,2 +1,4 @@\n a\n+b\n+c\n d'
    expect(reconstructOldContent(newContent, diff)).toBe('a\nd')
  })

  it('reverses a pure removal (restores removed lines)', () => {
    const newContent = 'a\nd'
    const diff = '@@ -1,4 +1,2 @@\n a\n-b\n-c\n d'
    expect(reconstructOldContent(newContent, diff)).toBe('a\nb\nc\nd')
  })

  it('reverses multiple hunks without index drift', () => {
    const newContent = 'A\nx\ny\nz\nB\np\nq\nC'
    const diff = '@@ -1,1 +1,1 @@\n-a\n+A\n@@ -5,1 +5,1 @@\n-b\n+B\n@@ -8,1 +8,1 @@\n-c\n+C'
    expect(reconstructOldContent(newContent, diff)).toBe('a\nx\ny\nz\nb\np\nq\nc')
  })

  it('preserves embedded language context across hunks (HTML scenario)', () => {
    const newContent = '<html>\n<body>\n<script>\nvar x = 1;\nvar y = 2;\nvar z = 3;\n</script>\n</body>\n</html>'
    const diff = '@@ -4,2 +4,3 @@\n var x = 1;\n+var y = 2;\n var z = 3;'
    const old = reconstructOldContent(newContent, diff)
    expect(old).toBe('<html>\n<body>\n<script>\nvar x = 1;\nvar z = 3;\n</script>\n</body>\n</html>')
    expect(old).toContain('<script>')
  })
})

describe('gutterWidth', () => {
  it('should return minimum width of 2', () => {
    expect(gutterWidth(1)).toBe(2)
    expect(gutterWidth(9)).toBe(2)
  })

  it('should return correct width for larger numbers', () => {
    expect(gutterWidth(10)).toBe(2)
    expect(gutterWidth(100)).toBe(3)
    expect(gutterWidth(999)).toBe(3)
    expect(gutterWidth(1000)).toBe(4)
  })
})
