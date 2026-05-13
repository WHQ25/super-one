import { useMemo, type ReactNode } from "react"
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import {
  BrandScope,
  ChatInputAdvancedMock,
  HARNESS_CLAUDE_HUE,
  type AttachmentMock,
  type ChatInputAdvancedMockProps,
  type ChatInputDirHintMock,
  type Harness,
  type MentionChipMock,
  type MentionPopupMock,
  type MiniAppContextChipMock,
  type PasteChipMock,
  type SlashPopupMock,
  type UserSelectionChipMock,
} from "@superone/desktop-mocks"

export const CHAT_INPUT_GALLERY_FPS = 30
export const CHAT_INPUT_GALLERY_WIDTH = 1280
export const CHAT_INPUT_GALLERY_HEIGHT = 800
const STAGE_SECONDS = 4
const FADE = 0.4

export type ChatInputGallerySceneProps = {
  harness: Harness
  brandHue: number
  darkMode: boolean
}

interface StageContent {
  title: string
  caption: string
  state: Partial<ChatInputAdvancedMockProps>
}

const STAGES: StageContent[] = [
  {
    title: "Prompt suggestion",
    caption: "Empty input · Tab to accept the agent's pre-typed suggestion.",
    state: {
      promptSuggestion:
        "Continue the rewrite: swap the remaining call sites over to the new useSession() hook.",
    },
  },
  {
    title: "Slash command popup",
    caption: "Type \"/\" to summon a fuzzy list of commands, intercepts, and skills.",
    state: {
      value: "/rev",
      slashPopup: {
        query: "rev",
        activeIndex: 0,
        commands: [
          {
            name: "review",
            description: "Run a code review against the staged diff",
            argumentHint: "<scope?>",
            matchIndices: [0, 1, 2],
          },
          {
            name: "revert",
            description: "Roll back the agent's last edit",
            matchIndices: [0, 1, 2],
          },
          {
            name: "rewrite",
            description: "Rewrite a function from a fresh spec",
            isSkill: true,
            matchIndices: [0, 1],
          },
        ],
      } satisfies SlashPopupMock,
    },
  },
  {
    title: "Mention popup",
    caption: "Type \"@\" to attach files, directories, or sub-agents to the next turn.",
    state: {
      value: "@chat",
      mentionPopup: {
        query: "chat",
        breadcrumbs: ["super-one", "apps", "desktop"],
        activeIndex: 1,
        items: [
          {
            kind: "file",
            name: "ChatInput.tsx",
            subtitle: "renderer/chat",
            matchIndices: [0, 1, 2, 3],
          },
          {
            kind: "file",
            name: "ChatMessage.tsx",
            subtitle: "renderer/chat",
            matchIndices: [0, 1, 2, 3],
          },
          {
            kind: "file",
            name: "ChatPanel.tsx",
            subtitle: "renderer/chat",
            matchIndices: [0, 1, 2, 3],
          },
          {
            kind: "directory",
            name: "chat/",
            subtitle: "renderer/components",
            matchIndices: [0, 1, 2, 3],
          },
          { kind: "agent", name: "code-reviewer", subtitle: "sonnet" },
        ],
      } satisfies MentionPopupMock,
    },
  },
  {
    title: "Mention chip inline",
    caption: "Selected mentions stay as atom chips so the model sees them as structured references.",
    state: {
      mentions: [
        { kind: "agent", displayName: "code-reviewer" },
        { kind: "directory", displayName: "packages/desktop-mocks/" },
        { kind: "file", displayName: "ChatInput.tsx" },
      ] satisfies MentionChipMock[],
      value: " — review the new chip layout end-to-end before we ship.",
    },
  },
  {
    title: "Drop to attach",
    caption: "Drag any file from Finder, the file tree, or external apps — the input lights up.",
    state: {
      value: "Working on this fix",
      isDragging: true,
    },
  },
  {
    title: "Image attachments",
    caption: "Images render as 48px thumbnails. Up to many in a row.",
    state: {
      value: "What's going wrong on this screen?",
      attachments: [
        { type: "image", name: "screenshot-1.png", thumbnail: { kind: "screenshot", hueA: 200, hueB: 260 } },
        { type: "image", name: "design.png", thumbnail: { kind: "screenshot", hueA: 30, hueB: 320 } },
        { type: "image", name: "wallpaper.jpg", thumbnail: { kind: "photo", hueA: 200, hueB: 260 } },
        { type: "image", name: "code.png", thumbnail: { kind: "code", accent: 200 } },
      ] satisfies AttachmentMock[],
    },
  },
  {
    title: "PDF attachments",
    caption: "PDFs render their first page; click to open the full viewer.",
    state: {
      value: "Summarize this design doc and call out anything you'd push back on.",
      attachments: [
        { type: "pdf", name: "spec.pdf", pages: 12 },
        { type: "pdf", name: "design-doc.pdf", pages: 8 },
        { type: "image", name: "preview.png", thumbnail: { kind: "screenshot", hueA: 200, hueB: 280 } },
      ] satisfies AttachmentMock[],
    },
  },
  {
    title: "Paste long text → chip",
    caption: "A multi-line paste collapses to a chip with a preview and line count, expandable later.",
    state: {
      value: "Fix the regression in here:",
      pasteChips: [
        {
          preview:
            "diff --git a/apps/desktop/src/renderer/src/components/chat/ChatInput.tsx b/apps/desk…",
          lineCount: 142,
        },
      ] satisfies PasteChipMock[],
    },
  },
  {
    title: "Mini-app suggests context",
    caption: "Mini-apps inject context via window.superone.setContext — user opts in with one click.",
    state: {
      miniAppContexts: [
        {
          appId: "calendar",
          appName: "Calendar",
          color: "#0ea5e9",
          summary: "3 meetings today",
          mode: "suggest",
          checked: false,
        },
      ] satisfies MiniAppContextChipMock[],
      value: "Plan my afternoon",
    },
  },
  {
    title: "Mini-app context active",
    caption: "Accepted context becomes always-on for the rest of the session.",
    state: {
      miniAppContexts: [
        {
          appId: "calendar",
          appName: "Calendar",
          color: "#0ea5e9",
          summary: "3 meetings today",
          mode: "always",
        },
        {
          appId: "linear",
          appName: "Linear",
          color: "#8b5cf6",
          summary: "5 issues in this sprint",
          mode: "always",
        },
      ] satisfies MiniAppContextChipMock[],
      value: "Plan my afternoon around what's on my plate.",
    },
  },
  {
    title: "Quote selection from canvas",
    caption: "Selections from the file viewer land as quote chips with file + line range.",
    state: {
      userSelections: [
        {
          filePath: "apps/desktop/src/renderer/src/components/chat/ChatInput.tsx",
          rangeText: "L412-L468",
        },
      ] satisfies UserSelectionChipMock[],
      value: "Why does this branch reset the slash dismissal?",
    },
  },
  {
    title: "All at once",
    caption: "Every chip type composed in a single turn — atoms keep ordering preserved.",
    state: {
      value: "ship the rewrite as-is.",
      mentions: [
        { kind: "agent", displayName: "code-reviewer" },
        { kind: "file", displayName: "ChatInput.tsx" },
      ] satisfies MentionChipMock[],
      pasteChips: [
        {
          preview:
            "diff --git a/apps/desktop/src/renderer/src/components/chat/ChatInput.tsx b/apps/desk…",
          lineCount: 96,
        },
      ] satisfies PasteChipMock[],
      attachments: [
        { type: "pdf", name: "spec.pdf", pages: 12 },
        { type: "image", name: "screenshot.png", thumbnail: { kind: "screenshot", hueA: 200, hueB: 260 } },
      ] satisfies AttachmentMock[],
      miniAppContexts: [
        {
          appId: "linear",
          appName: "Linear",
          color: "#8b5cf6",
          summary: "SUP-417",
          mode: "always",
        },
      ] satisfies MiniAppContextChipMock[],
      userSelections: [
        { filePath: "ChatInput.tsx", rangeText: "L412-L468" },
      ] satisfies UserSelectionChipMock[],
      additionalDirs: [
        { name: "shared", scope: "project" },
        { name: "scripts", scope: "session" },
      ] satisfies ChatInputDirHintMock[],
    },
  },
]

export const CHAT_INPUT_GALLERY_DURATION_IN_FRAMES =
  STAGES.length * STAGE_SECONDS * CHAT_INPUT_GALLERY_FPS

export const chatInputGallerySceneDefaultProps: ChatInputGallerySceneProps = {
  harness: "claude",
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

export const ChatInputGalleryScene = ({
  harness,
  brandHue,
  darkMode,
}: ChatInputGallerySceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const idx = Math.min(STAGES.length - 1, Math.floor(t / STAGE_SECONDS))
  const stage = STAGES[idx]
  const localT = t - idx * STAGE_SECONDS

  const opacity = interpolate(
    localT,
    [0, FADE, STAGE_SECONDS - FADE, STAGE_SECONDS],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )
  const yOffset = interpolate(localT, [0, FADE], [12, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const shellOpacity = interpolate(frame, [0, 0.4 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const caretOn = Math.floor(frame / (fps / 2)) % 2 === 0
  const stageRotation = useMemo<ReactNode>(() => {
    const props: ChatInputAdvancedMockProps = {
      harness,
      caretOn,
      ...stage.state,
    }
    return <ChatInputAdvancedMock {...props} />
  }, [stage, harness, caretOn])

  const stageProgress = STAGES.map((_, i) => i <= idx)

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="items-center justify-center bg-muted px-10 py-16">
        <div
          style={{ opacity: shellOpacity }}
          className="flex w-full max-w-[1100px] flex-col items-stretch gap-8"
        >
          <StageHeader title={stage.title} caption={stage.caption} index={idx} total={STAGES.length} />

          <div
            style={{ opacity, transform: `translateY(${yOffset}px)` }}
            className="rounded-2xl border border-border bg-card/80 px-6 py-8 shadow-xl ring-1 ring-border/40 backdrop-blur"
          >
            <div className="mx-auto w-full max-w-[880px]">{stageRotation}</div>
          </div>

          <ProgressDots progress={stageProgress} />
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}

function StageHeader({
  title,
  caption,
  index,
  total,
}: {
  title: string
  caption: string
  index: number
  total: number
}) {
  return (
    <div className="flex items-end justify-between gap-6">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Chat input reactions
        </div>
        <h2 className="mt-2 text-3xl font-semibold text-foreground">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{caption}</p>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          stage
        </div>
        <div className="font-mono text-xl font-semibold text-foreground">
          {String(index + 1).padStart(2, "0")}
          <span className="text-muted-foreground/60">/{String(total).padStart(2, "0")}</span>
        </div>
      </div>
    </div>
  )
}

function ProgressDots({ progress }: { progress: boolean[] }) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {progress.map((on, i) => (
        <span
          key={i}
          className={
            on
              ? "h-1.5 w-6 rounded-full bg-primary transition-colors"
              : "h-1.5 w-3 rounded-full bg-border transition-colors"
          }
        />
      ))}
    </div>
  )
}
