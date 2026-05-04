import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps, type ReactNode } from 'react'
import { CopyableMarkdown } from './CopyableMarkdown'

const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.webm', '.ogg', '.mov'])
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.aac', '.m4a', '.opus', '.weba'])

const MOCK_IMG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="280" viewBox="0 0 480 280"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fcd9b8"/><stop offset="1" stop-color="#f0a062"/></linearGradient></defs><rect width="480" height="280" fill="url(#g)"/><circle cx="380" cy="80" r="36" fill="#fff8" /><path d="M0 220 L120 160 L220 200 L340 130 L480 190 L480 280 L0 280 Z" fill="#864" opacity="0.6"/><text x="50%" y="50%" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="22" font-weight="600" fill="#fff">Mock image</text></svg>`
const MOCK_IMG_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(MOCK_IMG_SVG)}`

function getExt(src: string | undefined): string {
  if (!src) return ''
  try {
    const path = src.startsWith('local-file:') ? new URL(src).pathname : src
    const dot = path.lastIndexOf('.')
    return dot >= 0 ? path.slice(dot).toLowerCase() : ''
  } catch {
    return ''
  }
}

function MockMediaImg(props: ComponentProps<'img'>) {
  const ext = getExt(props.src)
  if (VIDEO_EXTS.has(ext)) {
    return (
      <div className="my-3 flex aspect-video w-full max-w-md items-center justify-center rounded-lg border border-border bg-muted text-sm text-muted-foreground">
        <span>mock video · {props.alt || ext}</span>
      </div>
    )
  }
  if (AUDIO_EXTS.has(ext)) {
    return (
      <div className="my-3 flex h-12 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-muted px-3 text-sm text-muted-foreground">
        <span className="size-2 rounded-full bg-primary" />
        <span>mock audio · {props.alt || ext}</span>
      </div>
    )
  }
  return <img {...props} src={MOCK_IMG_DATA_URL} alt={props.alt} />
}

function StoryShell({ children, width = 640 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof CopyableMarkdown> = {
  title: 'Chat/CopyableMarkdown',
  component: CopyableMarkdown,
  args: { isStreaming: false },
  argTypes: {
    isStreaming: { control: 'boolean' },
    text: { control: 'text' },
  },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <StoryShell>
        <Story />
      </StoryShell>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof CopyableMarkdown>

export const BasicFormatting: Story = {
  args: {
    text: [
      'Plain paragraph with **bold**, *italic*, ***bold-italic***, ~~strikethrough~~ and `inline code`.',
      '',
      'A second paragraph with a hard line break  ',
      'continued on the next line, plus a soft\nline break in source.',
      '',
      'Escapes: \\*not italic\\*, backslash before # heading marker should not turn into a heading: \\# stays.',
    ].join('\n'),
  },
}

export const Headings: Story = {
  args: {
    text: [
      '# Heading 1',
      '## Heading 2',
      '### Heading 3',
      '#### Heading 4',
      '##### Heading 5',
      '###### Heading 6',
      '',
      'Body text following each heading should sit close — chat-md uses tight margins.',
    ].join('\n'),
  },
}

export const Lists: Story = {
  args: {
    text: [
      'Unordered:',
      '- Item one',
      '- Item two with **bold**',
      '  - Nested level two (circle)',
      '    - Nested level three (square)',
      '- Item three',
      '',
      'Ordered:',
      '1. First',
      '2. Second',
      '   1. Nested ordered',
      '   2. Another nested',
      '3. Third',
      '',
      'Mixed:',
      '1. Step with sub-bullets',
      '   - sub a',
      '   - sub b',
      '2. Step two',
    ].join('\n'),
  },
}

export const Blockquotes: Story = {
  args: {
    text: [
      '> Single-level quote with *italic* and a [link](https://example.com).',
      '',
      '> Outer quote',
      '>',
      '> > Nested quote',
      '> >',
      '> > > Triple-nested quote',
      '',
      '> Quote containing a list:',
      '> - one',
      '> - two',
    ].join('\n'),
  },
}

export const HorizontalRule: Story = {
  args: {
    text: [
      'Section above the rule.',
      '',
      '---',
      '',
      'Section below the rule.',
      '',
      '***',
      '',
      'Another section after a star-rule.',
    ].join('\n'),
  },
}

export const Links: Story = {
  args: {
    text: [
      'External: [Anthropic](https://www.anthropic.com) — clicking should open the link-safety modal.',
      '',
      'Inline URL becomes auto-link: https://example.com/long/path?q=1',
      '',
      'Reference style: [docs][1] and [repo][2].',
      '',
      '[1]: https://example.com/docs',
      '[2]: https://github.com/example/repo',
    ].join('\n'),
  },
}

export const CodeBlocks: Story = {
  args: {
    text: [
      'TypeScript:',
      '```ts',
      'export function add(a: number, b: number): number {',
      '  return a + b',
      '}',
      '```',
      '',
      'Python:',
      '```python',
      'def fib(n: int) -> int:',
      '    return n if n < 2 else fib(n - 1) + fib(n - 2)',
      '```',
      '',
      'JSON:',
      '```json',
      '{ "name": "super-one", "version": "0.26.0-alpha" }',
      '```',
      '',
      'Shell:',
      '```sh',
      'bun run dev | tee dev.log',
      '```',
      '',
      'No language tag (renders as md):',
      '```',
      'just plain text',
      'second line',
      '```',
      '',
      'Inline `const x = 1` should not turn into a block.',
    ].join('\n'),
  },
}

export const NestedCodeFences: Story = {
  args: {
    text: [
      'A markdown code block that itself contains other code fences. `normalizeCodeFences` should upgrade the outer fence to four backticks so the inner triple-backtick blocks render as text.',
      '',
      '```markdown',
      '# Inner heading',
      '',
      '```python',
      'print("inner code")',
      '```',
      '',
      'And another:',
      '```ts',
      'const inner = true',
      '```',
      '',
      'End of outer markdown.',
      '```',
      '',
      'Text after the outer block.',
    ].join('\n'),
  },
}

export const MermaidDiagram: Story = {
  args: {
    text: [
      'Flowchart:',
      '',
      '```mermaid',
      'flowchart LR',
      '  User -->|sendMessage| Renderer',
      '  Renderer -->|IPC| Main',
      '  Main --> Claude[(Claude SDK)]',
      '  Claude --> Main',
      '  Main -->|event| Renderer',
      '```',
      '',
      'Sequence diagram:',
      '',
      '```mermaid',
      'sequenceDiagram',
      '  participant U as User',
      '  participant R as Renderer',
      '  participant M as Main',
      '  U->>R: type message',
      '  R->>M: agent.send',
      '  M-->>R: content_delta',
      '  M-->>R: message_complete',
      '```',
      '',
      'Broken syntax (should fall back to raw code):',
      '',
      '```mermaid',
      'graph TD',
      '  A --> B[Unclosed bracket',
      '```',
    ].join('\n'),
  },
}

export const MathFormulas: Story = {
  args: {
    text: [
      'Block math (Euler):',
      '',
      '$$',
      'e^{i\\pi} + 1 = 0',
      '$$',
      '',
      'Gaussian integral:',
      '',
      '$$',
      '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}',
      '$$',
      '',
      'Matrix:',
      '',
      '$$',
      '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
      '\\begin{pmatrix} x \\\\ y \\end{pmatrix}',
      '= \\begin{pmatrix} ax + by \\\\ cx + dy \\end{pmatrix}',
      '$$',
      '',
      'Inline (single-line `$$`): mass–energy $$E = mc^2$$ is famous. Single-dollar `$x$` should render as plain text since `singleDollarTextMath` is disabled — $x$ stays literal.',
    ].join('\n'),
  },
}

export const Tables: Story = {
  args: {
    text: [
      'Basic table:',
      '',
      '| Name | Role | Joined |',
      '| ---- | ---- | ------ |',
      '| Alice | Engineer | 2024-01 |',
      '| Bob | Designer | 2024-03 |',
      '| Carol | PM | 2024-06 |',
      '| Dan | Engineer | 2024-09 |',
      '',
      'Alignment:',
      '',
      '| Left | Center | Right |',
      '| :--- | :----: | ----: |',
      '| a | b | c |',
      '| long-left | long-center | long-right |',
      '',
      'Wide content (should scroll horizontally):',
      '',
      '| Column A | Column B | Column C | Column D | Column E | Column F |',
      '| -------- | -------- | -------- | -------- | -------- | -------- |',
      '| extremely-long-identifier-aaaa | value-bbbb | value-cccc | value-dddd | value-eeee | value-ffff |',
      '| second-row-aaaa | second-bbbb | second-cccc | second-dddd | second-eeee | second-ffff |',
    ].join('\n'),
  },
}

export const Media: Story = {
  args: {
    text: [
      'External image:',
      '',
      '![mountain](local-file:///fixtures/mountain.png)',
      '',
      'Local-file image (mocked):',
      '',
      '![cat](local-file:///Users/me/photos/cat.jpg)',
      '',
      'Inline video:',
      '',
      '![demo](local-file:///clips/demo.mp4)',
      '',
      'Inline audio:',
      '',
      '![voice](local-file:///audio/voice.mp3)',
    ].join('\n'),
  },
  render: (args) => (
    <CopyableMarkdown {...args} components={{ img: MockMediaImg } as never} />
  ),
}

export const InsightBlock: Story = {
  args: {
    text: [
      'Single insight:',
      '',
      '`★ Key finding ─────────────────────────────`',
      'The migration succeeded but **two** rows had unexpected nulls in `status`.',
      '`──────────────────────────────────────────`',
      '',
      'Wrapped in heading + reference fences:',
      '',
      '```markdown',
      '## `★ Architecture ─────────────────────────`',
      '- Separation of concerns between session and transport',
      '- Lock check lives **inside** the session, not in IPC',
      '`──────────────────────────────────────────`',
      '```',
      '',
      'Multiple insights back to back:',
      '',
      '`★ Risk ─────────────────────────────────────`',
      'Touching the relay protocol affects all mobile clients.',
      '`──────────────────────────────────────────────`',
      '',
      '`★ Mitigation ─────────────────────────────────`',
      'Rolling release: gate behind alpha tag for one cycle.',
      '`──────────────────────────────────────────────`',
      '',
      'Insight containing a code block:',
      '',
      '`★ Snippet ─────────────────────────────────`',
      '```ts',
      'session.claim(deviceId)',
      '```',
      '`────────────────────────────────────────────`',
    ].join('\n'),
  },
}

export const StreamingState: Story = {
  args: {
    text: [
      '## Building the response',
      '',
      'Here is some prose followed by a code block that is still being written:',
      '',
      '```ts',
      'function greet(name: string) {',
      '  return `hello, ${name',
    ].join('\n'),
  },
  render: (args) => (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          isStreaming = true
        </div>
        <CopyableMarkdown text={args.text} isStreaming={true} />
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          isStreaming = false
        </div>
        <CopyableMarkdown text={args.text} isStreaming={false} />
      </div>
    </div>
  ),
  decorators: [
    (Story) => (
      <StoryShell width={1024}>
        <Story />
      </StoryShell>
    ),
  ],
}

const LONG_FORM_TEXT = [
  '# Refactor plan: remote control ownership',
  '',
  '> Goal: move session ownership state out of `RemoteControlService` and onto each `Session` instance.',
  '',
  '## Why now',
  '',
  '- Two mobile clients on the same channel currently cross-talk.',
  '- Lock checks duplicated across IPC handlers.',
  '- Single source of truth makes audit trivial.',
  '',
  '## Approach',
  '',
  '1. Add `owner` and `subscribers` fields to the `Session` class.',
  '2. Move `claim` / `release` / `subscribe` / `unsubscribe` onto `Session`.',
  '3. Centralize disconnect cleanup in `device-registry.ts`.',
  '',
  '`★ Architecture ─────────────────────────────────────`',
  'Lock checks live **inside** `Session.send()`, not in `if`-walls scattered through IPC handlers. `RemoteControlService` becomes a pure transport.',
  '`──────────────────────────────────────────────────`',
  '',
  '## Sketch',
  '',
  '```ts',
  'class Session {',
  '  owner: Owner = { kind: "local" }',
  '  subscribers = new Set<string>()',
  '',
  '  send(text: string, origin: Origin) {',
  '    if (origin === "local" && this.isRemotelyControlled()) {',
  '      throw new SessionLockedError()',
  '    }',
  '    // …',
  '  }',
  '}',
  '```',
  '',
  '## Trade-offs',
  '',
  '| Option | Pro | Con |',
  '| ------ | --- | --- |',
  '| Per-session ownership | encapsulated, easy to reason about | every session pays a tiny memory cost |',
  '| Global registry | single map, easy to inspect | lock checks scattered, race-prone |',
  '| Hybrid | flexible | two sources of truth |',
  '',
  '## Math sanity',
  '',
  'For $$N$$ devices and $$M$$ sessions, memory is $$O(N + M)$$ — bounded.',
  '',
  '## Diagram',
  '',
  '```mermaid',
  'flowchart TD',
  '  Mobile -->|claim| Session',
  '  Session -->|owner_changed| Desktop',
  '  Session -->|owner_changed| OtherMobile',
  '```',
  '',
  '## Open questions',
  '',
  '- Should desktop be allowed to **kick** a remote owner mid-turn, or only between turns?',
  '- Do we need an explicit `release` ack, or is fire-and-forget enough?',
  '',
  '---',
  '',
  'See also: [`super-one-relay`](https://github.com/example/super-one-relay) for the protocol side.',
].join('\n')

export const LongFormResponse: Story = {
  args: { text: LONG_FORM_TEXT },
  render: (args) => {
    const [width, setWidth] = useState(672)
    return (
      <div>
        <div className="mb-3 flex items-center gap-3 text-xs">
          <span className="font-semibold uppercase tracking-wide text-muted-foreground">
            container width
          </span>
          <input
            type="range"
            min={320}
            max={960}
            step={16}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            className="w-48 accent-[var(--primary)]"
          />
          <span className="tabular-nums text-muted-foreground">{width}px</span>
          <span className="text-muted-foreground">
            (breakpoints: 512 · 672)
          </span>
        </div>
        <StoryShell width={width}>
          <CopyableMarkdown {...args} />
        </StoryShell>
      </div>
    )
  },
  decorators: [(Story) => <Story />],
}
