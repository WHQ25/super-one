import { describe, expect, it } from 'vitest'
import { createStreamFadePlugin, STREAM_FADE_CLASS, type StreamFadeController } from './stream-fade'

type HastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: { className?: string[] }
  children?: HastNode[]
}

function text(value: string): HastNode {
  return { type: 'text', value }
}

function el(tagName: string, children: HastNode[]): HastNode {
  return { type: 'element', tagName, properties: {}, children }
}

function doc(...children: HastNode[]): HastNode {
  return { type: 'root', children }
}

function run(fade: StreamFadeController, tree: HastNode) {
  fade.bind()
  // unified calls the plugin with a processor; the attacher ignores `this`.
  const transform = (fade.rehype as unknown as () => (tree: HastNode) => void)()
  transform(tree)
}

function classes(node: HastNode): string[] {
  const found: string[] = []
  if (node.properties?.className?.includes(STREAM_FADE_CLASS)) found.push(node.children?.map(child => child.value ?? '').join('') ?? '')
  for (const child of node.children ?? []) found.push(...classes(child))
  return found
}

describe('stream fade plugin', () => {
  it('fades each new prose commit and leaves an earlier commit in place', () => {
    let now = 1_000
    const fade = createStreamFadePlugin(() => now)
    const tree = doc(el('p', [text('hello')]))
    run(fade, tree)
    expect(classes(tree)).toEqual(['hello'])
    fade.commit()

    now = 1_030
    const next = doc(el('p', [text('hello!!')]))
    run(fade, next)
    expect(classes(next)).toEqual(['hello', '!!'])
    fade.commit()

    now = 1_125
    const later = doc(el('p', [text('hello!! next')]))
    run(fade, later)
    expect(classes(later)).toEqual(['!!', ' next'])
  })

  it('does not fade fenced code', () => {
    const fade = createStreamFadePlugin(() => 1_000)
    const tree = doc(
      el('p', [text('Before')]),
      el('pre', [el('code', [text('secret')])]),
      el('p', [text('After')]),
    )
    run(fade, tree)
    expect(classes(tree)).toEqual(['Before', 'After'])
    expect(tree.children?.[1].children?.[0].children?.[0].value).toBe('secret')
  })

  it('fades a syntactically complete paragraph while the turn is still streaming', () => {
    const fade = createStreamFadePlugin(() => 1_000)
    const tree = doc(el('p', [text('Hello')]))
    run(fade, tree)
    expect(classes(tree)).toEqual(['Hello'])
  })

  it('keeps two blocks from sharing commits', () => {
    const first = createStreamFadePlugin(() => 1_000)
    const second = createStreamFadePlugin(() => 1_000)
    const left = doc(el('p', [text('aaa')]))
    const right = doc(el('p', [text('bbbb')]))
    run(first, left)
    first.commit()
    run(second, right)
    second.commit()
    const grown = doc(el('p', [text('aaaZZ')]))
    run(first, grown)
    expect(classes(grown)).toEqual(['aaa', 'ZZ'])
  })
})
