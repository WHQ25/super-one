import { describe, expect, it } from 'vitest'
import { textContextPrefix, textCuts, textSlices } from './text-cuts'

const SIZE = 64

function paragraphs(count: number): string {
  return Array.from({ length: count }, (_, i) => `Paragraph ${i} says something reasonably long.`).join('\n\n')
}

describe('textCuts', () => {
  it('keeps a short text whole', () => {
    expect(textCuts('hello', undefined, SIZE).starts).toEqual([0])
  })

  it('slices cover the text exactly, each within the size', () => {
    const text = paragraphs(20)
    const slices = textSlices(text, textCuts(text, undefined, SIZE))
    expect(slices.map((s) => s.text).join('')).toBe(text)
    expect(slices.every((s) => s.text.length <= SIZE)).toBe(true)
    expect(slices.length).toBeGreaterThan(5)
  })

  it('prefers paragraph breaks', () => {
    const text = paragraphs(10)
    const { starts } = textCuts(text, undefined, SIZE)
    for (const start of starts.slice(1)) expect(text.slice(start - 2, start)).toBe('\n\n')
  })

  it('never moves an earlier cut when text is appended', () => {
    const full = paragraphs(40)
    let previous = textCuts(full.slice(0, 10), undefined, SIZE)
    for (let end = 10; end <= full.length; end += 37) {
      const resumed = textCuts(full.slice(0, end), previous, SIZE)
      const fresh = textCuts(full.slice(0, end), undefined, SIZE)
      expect(resumed.starts).toEqual(fresh.starts)
      expect(resumed.contexts).toEqual(fresh.contexts)
      expect(fresh.starts.slice(0, previous.starts.length)).toEqual(previous.starts)
      previous = resumed
    }
  })

  it('hard-cuts a line without breaks and keeps surrogate pairs whole', () => {
    const text = '😀'.repeat(100)
    const slices = textSlices(text, textCuts(text, undefined, SIZE + 1))
    expect(slices.map((s) => s.text).join('')).toBe(text)
    for (const slice of slices) expect(slice.text.length % 2).toBe(0)
  })

  it('carries the fence a slice starts inside', () => {
    const code = Array.from({ length: 30 }, (_, i) => `const value${i} = ${i}`).join('\n')
    const text = `Intro\n\n\`\`\`ts\n${code}\n\`\`\`\n\nAfter`
    const slices = textSlices(text, textCuts(text, undefined, SIZE))
    const inside = slices.filter((s) => s.context?.fence)
    expect(inside.length).toBeGreaterThan(0)
    expect(inside.every((s) => s.context?.fence === '```ts')).toBe(true)
    expect(textContextPrefix(inside[0].context)).toBe('```ts\n')
    expect(slices[slices.length - 1].context?.fence).toBeUndefined()
  })

  it('repeats the header rows of a table a slice starts inside', () => {
    const rows = Array.from({ length: 30 }, (_, i) => `| row ${i} | value ${i} |`).join('\n')
    const text = `| Name | Value |\n| --- | --- |\n${rows}`
    const slices = textSlices(text, textCuts(text, undefined, SIZE))
    expect(slices[1].context?.table).toBe('| Name | Value |\n| --- | --- |')
  })

  it('leaves out a context line too long to repeat in every slice', () => {
    const code = Array.from({ length: 30 }, (_, i) => `const value${i} = ${i}`).join('\n')
    const text = `\`\`\`ts ${'x'.repeat(2000)}\n${code}\n\`\`\``
    const slices = textSlices(text, textCuts(text, undefined, SIZE))
    expect(slices.length).toBeGreaterThan(1)
    expect(slices.every((s) => !s.context?.fence)).toBe(true)
  })
})
