import { splitTextIntoBlocks } from './split-text-blocks'

describe('splitTextIntoBlocks', () => {
  describe('final mode (streaming=false)', () => {
    it('should return empty for blank text', () => {
      expect(splitTextIntoBlocks('', false)).toEqual({ segments: [], remainder: '' })
      expect(splitTextIntoBlocks('   ', false)).toEqual({ segments: [], remainder: '' })
    })

    it('should return single text segment', () => {
      const { segments, remainder } = splitTextIntoBlocks('Hello world', false)
      expect(segments).toEqual([{ type: 'text', text: 'Hello world' }])
      expect(remainder).toBe('')
    })

    it('should split text around code fence', () => {
      const text = 'Before\n\n```ts\nconst x = 1\n```\n\nAfter'
      const { segments } = splitTextIntoBlocks(text, false)
      expect(segments).toHaveLength(3)
      expect(segments[0]).toEqual({ type: 'text', text: 'Before' })
      expect(segments[1]).toEqual({ type: 'text', text: '```ts\nconst x = 1\n```' })
      expect(segments[2]).toEqual({ type: 'text', text: 'After' })
    })

    it('should handle code fence without language', () => {
      const text = '```\nhello\n```'
      const { segments } = splitTextIntoBlocks(text, false)
      expect(segments).toHaveLength(1)
      expect(segments[0].text).toBe('```\nhello\n```')
    })

    it('should handle unclosed code fence as plain text', () => {
      const text = 'Before\n\n```ts\nconst x = 1'
      const { segments } = splitTextIntoBlocks(text, false)
      expect(segments).toHaveLength(2)
      expect(segments[0].text).toBe('Before')
      expect(segments[1].text).toContain('```ts')
      expect(segments[1].text).toContain('const x = 1')
    })

    it('should split table into its own segment', () => {
      const text = 'Before\n| a | b |\n|---|---|\n| 1 | 2 |\nAfter'
      const { segments } = splitTextIntoBlocks(text, false)
      expect(segments).toHaveLength(3)
      expect(segments[0].text).toBe('Before')
      expect(segments[1].text).toContain('| a | b |')
      expect(segments[2].text).toBe('After')
    })

    it('should extract insight blocks', () => {
      const text = 'Before\n`★ My Title ─────────────────────────────`\nLine 1\nLine 2\n`─────────────────────────────────────────────────`\nAfter'
      const { segments } = splitTextIntoBlocks(text, false)
      expect(segments).toHaveLength(3)
      expect(segments[0]).toEqual({ type: 'text', text: 'Before' })
      expect(segments[1]).toEqual({ type: 'insight', text: '', title: 'My Title', content: 'Line 1\nLine 2' })
      expect(segments[2]).toEqual({ type: 'text', text: 'After' })
    })

    it('should handle multiple code blocks', () => {
      const text = '```js\na()\n```\n\nMiddle\n\n```py\nb()\n```'
      const { segments } = splitTextIntoBlocks(text, false)
      expect(segments).toHaveLength(3)
      expect(segments[0].text).toBe('```js\na()\n```')
      expect(segments[1].text).toBe('Middle')
      expect(segments[2].text).toBe('```py\nb()\n```')
    })
  })

  describe('streaming mode', () => {
    it('should keep unclosed code fence as remainder', () => {
      const text = 'Before\n\n```ts\nconst x = 1'
      const { segments, remainder } = splitTextIntoBlocks(text, true)
      expect(segments).toHaveLength(1)
      expect(segments[0].text).toBe('Before')
      expect(remainder).toBe('```ts\nconst x = 1')
    })

    it('should keep unclosed insight as remainder', () => {
      const text = 'Before\n`★ Title ─────────────────────────────`\nPartial'
      const { segments, remainder } = splitTextIntoBlocks(text, true)
      expect(segments).toHaveLength(1)
      expect(segments[0].text).toBe('Before')
      expect(remainder).toContain('★ Title')
      expect(remainder).toContain('Partial')
    })

    it('should keep tail after last paragraph break as remainder', () => {
      const text = 'Paragraph one.\n\nP'
      const { segments, remainder } = splitTextIntoBlocks(text, true)
      expect(segments).toHaveLength(1)
      expect(segments[0].text).toBe('Paragraph one.')
      expect(remainder).toBe('P')
    })

    it('should not produce single-char segments from paragraph tails', () => {
      const text = '从前有一只猫。\n\n每'
      const { segments, remainder } = splitTextIntoBlocks(text, true)
      expect(segments).toHaveLength(1)
      expect(segments[0].text).toBe('从前有一只猫。')
      expect(remainder).toBe('每')
    })

    it('should keep all text as remainder when no paragraph break', () => {
      const text = 'Hello world'
      const { segments, remainder } = splitTextIntoBlocks(text, true)
      expect(segments).toHaveLength(0)
      expect(remainder).toBe('Hello world')
    })

    it('should emit completed code fence and keep tail as remainder', () => {
      const text = '```ts\nconst x = 1\n```\n\nAfter'
      const { segments, remainder } = splitTextIntoBlocks(text, true)
      expect(segments).toHaveLength(1)
      expect(segments[0].text).toBe('```ts\nconst x = 1\n```')
      expect(remainder).toBe('\nAfter')
    })

    it('should emit completed code fence with no trailing text', () => {
      const text = '```ts\nconst x = 1\n```'
      const { segments, remainder } = splitTextIntoBlocks(text, true)
      expect(segments).toHaveLength(1)
      expect(segments[0].text).toBe('```ts\nconst x = 1\n```')
      expect(remainder).toBe('')
    })

    it('should handle multiple paragraph breaks keeping only tail', () => {
      const text = 'Para 1.\n\nPara 2.\n\nP'
      const { segments, remainder } = splitTextIntoBlocks(text, true)
      expect(segments).toHaveLength(1)
      expect(segments[0].text).toBe('Para 1.\n\nPara 2.')
      expect(remainder).toBe('P')
    })
  })

  describe('streaming accumulation simulation', () => {
    function simulateStreaming(deltas: string[]) {
      let pendingText = ''
      let flushedLen = 0
      const emitted: string[] = []

      function flush(final: boolean) {
        if (pendingText.trim().length === 0) { pendingText = ''; flushedLen = 0; return }
        const { segments, remainder } = splitTextIntoBlocks(pendingText, !final)
        if (remainder) { pendingText = remainder; flushedLen = remainder.length }
        else { pendingText = ''; flushedLen = 0 }
        for (const seg of segments) emitted.push(seg.text)
      }

      for (const d of deltas) {
        pendingText += d
        const newLen = pendingText.length - flushedLen
        if (newLen > 0 && (pendingText.lastIndexOf('\n\n') > flushedLen || newLen >= 1000)) {
          flush(false)
        }
      }
      flush(true)
      return emitted
    }

    it('should not produce single-char segments for multi-paragraph text', () => {
      const emitted = simulateStreaming([
        '从前有一只猫，', '名叫阿橘。', '\n\n每', '天夜里读书。',
        '\n\n来', '书店出了名。', '\n\n阿', '橘毫不在意。',
      ])
      expect(emitted).toEqual([
        '从前有一只猫，名叫阿橘。',
        '每天夜里读书。',
        '来书店出了名。',
        '阿橘毫不在意。',
      ])
    })

    it('should keep codeblock intact and not fragment trailing text', () => {
      const BT = '```'
      const emitted = simulateStreaming([
        BT, 'ts\nconst x = 1\n\nconst y = 2\n' + BT,
        '\n\n这', '是代码说明。',
      ])
      expect(emitted).toHaveLength(2)
      expect(emitted[0]).toBe('```ts\nconst x = 1\n\nconst y = 2\n```')
      expect(emitted[1]).toBe('这是代码说明。')
    })

    it('should handle text with no paragraph breaks', () => {
      const emitted = simulateStreaming(['Hello ', 'world ', 'foo'])
      expect(emitted).toEqual(['Hello world foo'])
    })
  })
})
