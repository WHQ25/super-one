/** @vitest-environment jsdom */
import { markdownOfRange } from './selection-markdown'

/** A reply as Streamdown renders it (trimmed to the parts the converter reads). */
const REPLY = `
<div class="chat-md"><div>
  <h2 data-streamdown="heading-2">Root cause</h2>
  <p>Lost at <span data-streamdown="strong">two</span> points, see <a href="https://example.com/plan"><svg></svg>the plan</a> and <code>insert_content</code>:</p>
  <ol data-streamdown="ordered-list">
    <li data-streamdown="list-item"><span data-streamdown="strong">Copy</span>: images go last.</li>
    <li data-streamdown="list-item"><span data-streamdown="strong">Paste</span>: text goes first.
      <ul data-streamdown="unordered-list"><li>nested <em>detail</em></li><li>second</li></ul>
    </li>
    <li data-streamdown="list-item">Third step</li>
  </ol>
  <div data-chat-codeblock="true"><div><span>ts</span><button>copy</button></div><pre><code>const a = 1
console.log(a)</code></pre></div>
  <div data-streamdown="table-wrapper"><div><table>
    <thead><tr><th>Side</th><th style="text-align: center">Fix</th></tr></thead>
    <tbody><tr><td>Copy</td><td>order | blocks</td></tr><tr><td>Paste</td><td>one insert</td></tr></tbody>
  </table></div><button>Expand</button></div>
  <p>Inline <span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">a^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">a2</span></span> math</p>
  <ul data-streamdown="unordered-list"><li class="task-list-item"><input type="checkbox" checked> done task</li></ul>
</div></div>`

function setup(): HTMLElement {
  document.body.innerHTML = REPLY
  return document.querySelector<HTMLElement>('.chat-md')!
}

const rangeOver = (node: Node): Range => {
  const range = document.createRange()
  range.selectNodeContents(node)
  return range
}

const textIn = (root: Element, needle: string): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.includes(needle)) return node as Text
  }
  throw new Error(`no text ${needle}`)
}

describe('markdownOfRange', () => {
  it('turns a whole reply back into Markdown, blocks separated by blank lines', () => {
    const md = markdownOfRange(rangeOver(setup()))!

    expect(md.split('\n\n')).toEqual([
      '## Root cause',
      'Lost at **two** points, see [the plan](https://example.com/plan) and `insert_content`:',
      '1. **Copy**: images go last.\n2. **Paste**: text goes first.\n   - nested *detail*\n   - second\n3. Third step',
      '```ts\nconst a = 1\nconsole.log(a)\n```',
      '| Side | Fix |\n| --- | :---: |\n| Copy | order \\| blocks |\n| Paste | one insert |',
      'Inline $a^2$ math',
      '- [x] done task',
    ])
  })

  it('numbers a list from where the selection starts, not from 1', () => {
    const root = setup()
    const items = root.querySelectorAll('ol > li')
    const range = document.createRange()
    range.setStart(textIn(items[1]!, 'Paste'), 0)
    range.setEnd(textIn(items[2]!, 'Third'), 5)

    expect(markdownOfRange(range)).toBe('2. **Paste**: text goes first.\n   - nested *detail*\n   - second\n3. Third')
  })

  it('drops the marker of an item the selection starts inside', () => {
    const root = setup()
    const items = root.querySelectorAll('ol > li')
    const range = document.createRange()
    range.setStart(textIn(items[0]!, 'images'), 2)
    range.setEnd(textIn(items[2]!, 'Third'), 5)

    expect(markdownOfRange(range)).toMatch(/^images go last\.\n2\. \*\*Paste\*\*/)
  })

  it('copies a rendered diagram as its fenced source', () => {
    document.body.innerHTML = `<div class="chat-md"><div>
      <p>Flow:</p>
      <div data-chat-codeblock="true" data-code-source="graph TD\n  A --> B\n"><div><span>Mermaid</span><button>copy</button></div><div><svg><text>A</text></svg></div></div>
    </div></div>`

    expect(markdownOfRange(rangeOver(document.querySelector('.chat-md')!))).toBe('Flow:\n\n```mermaid\ngraph TD\n  A --> B\n```')
  })

  it('leaves a selection inside code to the browser, copied raw', () => {
    expect(markdownOfRange(rangeOver(setup().querySelector('pre')!))).toBeNull()
  })

  it('ignores selections outside a rendered reply', () => {
    document.body.innerHTML = '<div><p>plain <b>bold</b></p></div>'
    expect(markdownOfRange(rangeOver(document.body))).toBeNull()
  })
})
