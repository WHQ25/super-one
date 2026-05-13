import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import {
  BrandScope,
  DesktopShell,
  FilePreviewMock,
  FileTreeMock,
  HARNESS_CLAUDE_HUE,
  SAMPLE_FILE_TREE,
  type FilePreviewSpec,
  type FileTreeNode,
} from "@superone/desktop-mocks"

export const FILE_PREVIEW_FPS = 30
export const FILE_PREVIEW_WIDTH = 1280
export const FILE_PREVIEW_HEIGHT = 800
export const FILE_PREVIEW_DURATION_IN_FRAMES = 18 * FILE_PREVIEW_FPS

export type FilePreviewSceneProps = {
  brandHue: number
  darkMode: boolean
}

export const filePreviewSceneDefaultProps: FilePreviewSceneProps = {
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

const PREVIEW_STAGES: Array<{ label: string; spec: FilePreviewSpec; selectPath: string }> = [
  {
    label: "Code · TypeScript",
    selectPath: "packages/desktop-mocks/src/desktop/chat-mock.tsx",
    spec: {
      kind: "code",
      filePath: "packages/desktop-mocks/src/desktop/chat-mock.tsx",
      language: "tsx",
      startLine: 211,
      code: `function computeReveal(
  messages: MockMessage[],
  currentMs: number,
  opts: { typingCps: number; userPauseMs: number; assistantPauseMs: number },
): RevealState {
  const visible: MockMessage[] = []
  let streamingId: string | null = null
  let t = 0
  for (const msg of messages) {
    if (msg.role === "user") {
      t += opts.userPauseMs
      if (currentMs < t) break
      visible.push(msg)
    } else {
      t += opts.assistantPauseMs
      const total = messageTextLength(msg)
      const durationMs = total === 0 ? 0 : (total / opts.typingCps) * 1000
      const startMs = t
      const endMs = t + durationMs
      if (currentMs < startMs) break
      if (currentMs >= endMs || durationMs === 0) {
        visible.push(msg)
        t = endMs
        continue
      }
      const ratio = (currentMs - startMs) / durationMs
      const chars = Math.max(1, Math.floor(total * ratio))
      visible.push(revealMessage(msg, chars))
      streamingId = msg.id
      break
    }
  }
  return { visible, streamingId }
}`,
    },
  },
  {
    label: "Markdown · README",
    selectPath: "README.md",
    spec: {
      kind: "markdown",
      filePath: "README.md",
      content: `# SuperOne

SuperOne is an Electron meta desktop app that doubles as an IDE and as a canvas
for users to build their own mini-apps with AI agents as the engine.

## Mock package

\`@superone/desktop-mocks\` ships the UI components from the desktop app in a form
that is **safe to render** outside Electron — used by:

- [Storybook](https://storybook.js.org) for component QA
- The marketing site (\`apps/web\`)
- The Remotion video pipeline (\`apps/video\`)

### Coverage

> Every chat block type, every tool variant, every permission shape — the
> same components, just driven by an optional \`frame\` prop.

\`\`\`bash
bun run dev:video         # Remotion studio
bun run storybook         # Storybook
bun run dev:web           # Next.js marketing site
\`\`\``,
    },
  },
  {
    label: "Diff · Edit",
    selectPath: "apps/desktop/src/renderer/src/App.tsx",
    spec: {
      kind: "diff",
      filePath: "apps/desktop/src/renderer/src/App.tsx",
      startLine: 84,
      oldText: `function useExpansion() {
  const [expanded, setExpanded] = useState(false)
  return { expanded, setExpanded }
}`,
      newText: `function useExpansion() {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggle = (path: string) => setExpanded((prev) => {
    const next = new Set(prev)
    next.has(path) ? next.delete(path) : next.add(path)
    return next
  })
  return { expanded, toggle }
}`,
    },
  },
  {
    label: "Image · Screenshot",
    selectPath: "docs/marketing/hero.png",
    spec: {
      kind: "image",
      filePath: "docs/marketing/hero.png",
      src: "",
      alt: "docs/marketing/hero.png",
    },
  },
]

function setSelected(nodes: FileTreeNode[], path: string): FileTreeNode[] {
  return nodes.map((n) => {
    const next: FileTreeNode = { ...n, selected: n.path === path }
    if (n.children) next.children = setSelected(n.children, path)
    return next
  })
}

function ensurePathVisible(nodes: FileTreeNode[], path: string): FileTreeNode[] {
  const segments = path.split("/")
  return nodes.map((n) => {
    const matches = path === n.path || path.startsWith(`${n.path}/`)
    const next: FileTreeNode = { ...n }
    if (matches && n.isDirectory && segments.length > 1) next.isExpanded = true
    if (n.children) next.children = ensurePathVisible(n.children, path)
    return next
  })
}

export const FilePreviewScene = ({ brandHue, darkMode }: FilePreviewSceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const stageDuration = 4
  const idx = Math.min(PREVIEW_STAGES.length - 1, Math.floor(t / stageDuration))
  const stage = PREVIEW_STAGES[idx]

  const nodes = setSelected(ensurePathVisible(SAMPLE_FILE_TREE, stage.selectPath), stage.selectPath)

  const localT = t - idx * stageDuration
  const stageOpacity = interpolate(
    localT,
    [0, 0.35, stageDuration - 0.35, stageDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
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
          <DesktopShell
            headerTitle={stage.label}
            sidebarTab="files"
            fileTree={
              <FileTreeMock rootName="super-one" nodes={nodes} selectedPath={stage.selectPath} />
            }
            showTrafficLights
          >
            <div style={{ opacity: stageOpacity }} className="h-full">
              <FilePreviewMock spec={stage.spec} />
            </div>
          </DesktopShell>
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}
