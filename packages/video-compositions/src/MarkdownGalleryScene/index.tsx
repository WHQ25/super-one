import { useMemo } from "react"
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import {
  BrandScope,
  ChatMock,
  HARNESS_CLAUDE_HUE,
  type Harness,
  type MockMessage,
} from "@superone/desktop-mocks"

export const MARKDOWN_GALLERY_FPS = 30
export const MARKDOWN_GALLERY_WIDTH = 1280
export const MARKDOWN_GALLERY_HEIGHT = 800
export const MARKDOWN_GALLERY_DURATION_IN_FRAMES = 45 * MARKDOWN_GALLERY_FPS

export type MarkdownGallerySceneProps = {
  harness: Harness
  brandHue: number
  darkMode: boolean
}

export const markdownGallerySceneDefaultProps: MarkdownGallerySceneProps = {
  harness: "claude",
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

const FULL_MARKDOWN = `# Markdown showcase

Here's every block I can render — **bold**, *italic*, ~~strikethrough~~, \`inline code\`, and [a link](https://www.remotion.dev). Inline math works too: the famous identity is below.

## Lists

1. Replace boolean expansion state with a \`Set<string>\` keyed by \`folderPath\`.
2. Wire the chevron's \`onClick\` to toggle that set.
3. Bail out when focus is in an editable input.

- Unordered item one.
- Unordered item two with \`inline code\`.
- Unordered item three.

## Task list

- [x] Wire \`keydown\` listener
- [x] Add Cmd+Shift+[ shortcut
- [ ] Persist expansion to localStorage

## Quote

> Mock UI must match desktop UI — don't invent your own. Read the source, then translate.
>
> Nested quotes work as well — useful for replying inline.

## Table

| Tool | Variant | Coverage |
| --- | --- | --- |
| Edit | diff | 100% |
| Bash | terminal | 100% |
| Grep | search | 100% |
| MCP | plug · tool | 95% |

## Code blocks

\`\`\`ts
useKeyboardShortcut('mod+shift+[', () => {
  if (activeFolder) toggle(activeFolder)
})
\`\`\`

\`\`\`diff
- const [expanded, setExpanded] = useState(false)
+ const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
\`\`\`

\`\`\`json
{
  "tool": "Edit",
  "variant": "diff",
  "coverage": 1.0
}
\`\`\`

## Mermaid diagram

\`\`\`mermaid
flowchart LR
  Plan[Plan turn] --> Code[Edit files]
  Code --> Run[Run tests]
  Run -->|pass| Done[Done]
  Run -->|fail| Code
\`\`\`

## Math (KaTeX)

Block math renders via the \`mathPlugin\`:

$$
E = mc^2
$$

A slightly chunkier one — Gauss's sum:

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

## Insight callout

★ Insight ─────────────────────────────────────
- Streamdown is engineered for **token-level** streaming — half-closed fences (\`\`\`​mermaid without trailer) won't crash the renderer.
- Mermaid diagrams render only after the fence closes; before that they fall back to the regular highlighted code block.
- KaTeX is gated by \`$$...$$\` block delimiters; single-dollar inline math is disabled to avoid conflicts with prose.
─────────────────────────────────────────────────

---

That covers headings, paragraphs, ordered/unordered lists, task lists, blockquotes, tables, code blocks (TypeScript / diff / JSON), horizontal rules, **Mermaid flowcharts**, **KaTeX math blocks**, and the \`★ Insight\` callout.`

const LINK_RE = /^!?\[[^\]]*\]\([^)\s]*\)/
const WORD_RE = /^(?:\s+|[^\s\w]+|\w+)/

function tokenize(text: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    const linkMatch = text.slice(i).match(LINK_RE)
    if (linkMatch) {
      out.push(linkMatch[0])
      i += linkMatch[0].length
      continue
    }
    const match = text.slice(i).match(WORD_RE)
    if (!match) {
      out.push(text[i]!)
      i++
      continue
    }
    const word = match[0]
    if (/^\w+$/.test(word) && word.length > 6) {
      for (let j = 0; j < word.length; j += 4) {
        out.push(word.slice(j, j + 4))
      }
    } else {
      out.push(word)
    }
    i += word.length
  }
  return out
}

function computeRevealedTokens(frame: number, total: number): number {
  let count = 0
  for (let f = 0; f <= frame; f++) {
    const noise = Math.sin(f * 12.9898 + 78.233) * 43758.5453
    const r = noise - Math.floor(noise)
    const burstNoise = Math.sin(f * 7.31 + 21.7) * 18923.71
    const r2 = burstNoise - Math.floor(burstNoise)
    const base = r >= 0.3 ? 1 : 0
    const burst = r2 >= 0.85 ? 2 : 0
    count += base + burst
    if (count >= total) return total
  }
  return count
}

export const MarkdownGalleryScene = ({
  harness,
  brandHue,
  darkMode,
}: MarkdownGallerySceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const tokens = useMemo(() => tokenize(FULL_MARKDOWN), [])
  const visibleCount = computeRevealedTokens(frame, tokens.length)
  const revealedText = useMemo(
    () => tokens.slice(0, visibleCount).join(""),
    [tokens, visibleCount],
  )
  const isStreaming = visibleCount < tokens.length

  const messages: MockMessage[] = useMemo(
    () => [
      {
        id: "u1",
        role: "user",
        text: "Show me every markdown element you can render — mermaid, math, callouts, the lot.",
      },
      {
        id: "a1",
        role: "assistant",
        blocks: [
          {
            type: "thinking",
            done: !isStreaming,
            text:
              "Plan: walk through each block category top to bottom. Save mermaid + KaTeX + ★ Insight for the back half so they land after the basics.",
          },
          { type: "markdown", text: revealedText, isStreaming },
        ],
      },
    ],
    [revealedText, isStreaming],
  )

  const shellOpacity = interpolate(frame, [0, 0.4 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="items-center justify-center bg-muted p-6">
        <div
          style={{ width: 1232, height: 752, opacity: shellOpacity }}
          className="overflow-hidden rounded-2xl shadow-2xl ring-1 ring-border/60"
        >
          <ChatMock
            title="Markdown showcase"
            harness={harness}
            messages={messages}
            frame={frame}
            fps={fps}
            typingCps={1e9}
            assistantPauseMs={0}
            userPauseMs={0}
            autoScroll
            showTrafficLights
          />
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}
