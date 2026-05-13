import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import type { ReactNode } from "react"
import {
  BrandScope,
  HARNESS_CLAUDE_HUE,
  ToolBlockMock,
  SandboxNetworkBanner,
  TodoPopupMock,
  type ToolBlockSpec,
  type TodoPopupItem,
} from "@superone/desktop-mocks"

export const TOOL_GALLERY_FPS = 30
export const TOOL_GALLERY_WIDTH = 1280
export const TOOL_GALLERY_HEIGHT = 800
export const TOOL_GALLERY_DURATION_IN_FRAMES = 18 * TOOL_GALLERY_FPS

export type ToolBlockGallerySceneProps = {
  brandHue: number
  darkMode: boolean
}

export const toolBlockGallerySceneDefaultProps: ToolBlockGallerySceneProps = {
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

type GalleryEntry =
  | { label: string; spec: ToolBlockSpec; expanded?: boolean }
  | { label: string; node: ReactNode }

const TOOL_SPECS: GalleryEntry[] = [
  {
    label: "Bash",
    expanded: true,
    spec: {
      variant: "bash",
      command: "bun run typecheck",
      output:
        "$ bun run typecheck\n✓ apps/desktop\n✓ apps/web\n✓ packages/ui\n✓ packages/shared\nAll clean.",
    },
  },
  {
    label: "Edit (diff)",
    expanded: true,
    spec: {
      variant: "edit",
      filePath: "apps/desktop/src/renderer/src/components/sidebar/AppSidebar.tsx",
      startLine: 312,
      oldText: "const [expanded, setExpanded] = useState(false)",
      newText:
        "const [expanded, setExpanded] = useState<Set<string>>(() => new Set())\nconst toggle = (path: string) => setExpanded((prev) => {\n  const next = new Set(prev)\n  next.has(path) ? next.delete(path) : next.add(path)\n  return next\n})",
    },
  },
  {
    label: "Write",
    expanded: true,
    spec: {
      variant: "write",
      filePath: "packages/desktop-mocks/src/desktop/file-tree-mock.tsx",
      content:
        'export function FileTreeMock(props: Props) {\n  return <div className="flex h-full flex-col">{...}</div>\n}',
    },
  },
  {
    label: "Read",
    expanded: true,
    spec: {
      variant: "read",
      filePath: "packages/shared/src/agent-types.ts",
      lineRange: "L1–L120",
      preview:
        "export interface ChatMessage { id: string; role: 'user' | 'assistant'; ... }\nexport type AgentEvent =\n  | { type: 'message_start'; ... }\n  | { type: 'permission_request'; ... }",
    },
  },
  {
    label: "Grep",
    expanded: true,
    spec: {
      variant: "grep",
      pattern: "PermissionPrompt",
      path: "apps/desktop/src/renderer/src/components",
      matches:
        "chat/PermissionPrompt.tsx:104  export function PermissionPrompt() {\nchat/PermissionPrompt.integration.test.tsx:18  describe('PermissionPrompt', ...)\nchat/PermissionModeList.tsx:42  ... PermissionPrompt …",
    },
  },
  {
    label: "Glob",
    spec: {
      variant: "glob",
      pattern: "**/*.stories.tsx",
      path: "packages",
      matches:
        "packages/ui/src/components/ui/button.stories.tsx\npackages/desktop-mocks/src/desktop/chat-mock.stories.tsx",
    },
  },
  {
    label: "WebSearch",
    spec: { variant: "webSearch", query: "Remotion compositions list" },
  },
  {
    label: "WebFetch",
    spec: { variant: "webFetch", url: "https://www.remotion.dev/docs/composition" },
  },
  {
    label: "Task (subagent)",
    spec: {
      variant: "task",
      subagent: "code-reviewer",
      description: "Review chat permission flow",
    },
  },
  {
    label: "MCP",
    spec: {
      variant: "mcp",
      serverName: "context7",
      toolName: "query-docs",
      summary: "library: react · query: useEffect",
    },
  },
  {
    label: "Skill",
    spec: { variant: "skill", skill: "generate-test-cases" },
  },
  {
    label: "TodoWrite (popup)",
    node: (
      <TodoPopupMock
        className="m-0"
        expanded
        showKbdHint={false}
        items={[
          { id: "1", text: "Add ToolBlockMock variants", status: "completed" },
          { id: "2", text: "Add AskUserQuestionMock", status: "completed" },
          { id: "3", text: "Wire Remotion scenes", status: "in_progress" },
          { id: "4", text: "Run still render verification", status: "pending" },
        ] satisfies TodoPopupItem[]}
      />
    ),
  },
  {
    label: "AskUserQuestion (Q&A)",
    expanded: true,
    spec: {
      variant: "askUserQuestion",
      summary: "2 questions",
      qa: [
        { question: "Approach", answer: "Frame-driven mock" },
        { question: "Coverage", answer: "All tool variants" },
      ],
    },
  },
  {
    label: "Bash (denied)",
    spec: {
      variant: "bash",
      command: "rm -rf node_modules",
      denied: true,
    },
  },
  {
    label: "FileChange (error)",
    spec: {
      variant: "generic",
      tool: "FileChange",
      summary: "src/missing.ts",
      bodyText: "File not found",
      errored: true,
    },
  },
  {
    label: "ExitPlanMode → Approved (banner)",
    spec: { variant: "banner", kind: "planApproved" },
  },
  {
    label: "ExitPlanMode → Rejected (banner)",
    spec: {
      variant: "banner",
      kind: "planRejected",
      feedback: "Need to address auth flow before refactoring sidebar",
    },
  },
  {
    label: "EnterPlanMode (banner)",
    spec: { variant: "banner", kind: "enterPlanMode" },
  },
]

const CARD_PER_COLUMN = 6
const COLUMNS = 3

export const ToolBlockGalleryScene = ({ brandHue, darkMode }: ToolBlockGallerySceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="bg-muted">
        <div className="mx-auto w-full max-w-[1760px] px-12 pt-10 pb-6">
          <div className="mb-4 text-2xl font-semibold text-foreground">All tool block variants</div>
          <SandboxNetworkBanner host="dl.super-one.dev" />
        </div>
        <div className="mx-auto grid w-full max-w-[1760px] flex-1 grid-cols-3 gap-4 px-12 pb-12">
          {Array.from({ length: COLUMNS }).map((_, col) => {
            const items = TOOL_SPECS.slice(col * CARD_PER_COLUMN, (col + 1) * CARD_PER_COLUMN)
            return (
              <div key={col} className="flex flex-col gap-2">
                {items.map((item, idx) => {
                  const globalIdx = col * CARD_PER_COLUMN + idx
                  const t = globalIdx * 0.18
                  const opacity = interpolate(
                    frame,
                    [t * fps, (t + 0.5) * fps],
                    [0, 1],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                  )
                  const translateY = interpolate(
                    frame,
                    [t * fps, (t + 0.5) * fps],
                    [12, 0],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                  )
                  return (
                    <div
                      key={item.label}
                      className="rounded-lg border border-border bg-card p-3 shadow-sm"
                      style={{ opacity, transform: `translateY(${translateY}px)` }}
                    >
                      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {item.label}
                      </div>
                      {"node" in item ? (
                        item.node
                      ) : (
                        <ToolBlockMock spec={item.spec} expanded={item.expanded} />
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}
