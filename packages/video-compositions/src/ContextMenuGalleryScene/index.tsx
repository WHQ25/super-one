import { type ReactNode } from "react"
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import {
  AUTOMATION_ROW_CONTEXT_MENU,
  BrandScope,
  ContextMenuMock,
  FILE_QUOTE_CONTEXT_MENU,
  FILE_ROW_CONTEXT_MENU,
  FOLDER_ROW_CONTEXT_MENU,
  HARNESS_CLAUDE_HUE,
  IMAGE_CONTEXT_MENU,
  PROJECT_ROW_CONTEXT_MENU,
  SESSION_ROW_CONTEXT_MENU,
  TEXT_SELECTION_CONTEXT_MENU,
  type ContextMenuEntry,
  type Harness,
} from "@superone/desktop-mocks"
import {
  Bot,
  CalendarClock,
  CircleCheck,
  File,
  FileCode,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Pin,
} from "lucide-react"

export const CONTEXT_MENU_GALLERY_FPS = 30
export const CONTEXT_MENU_GALLERY_WIDTH = 1280
export const CONTEXT_MENU_GALLERY_HEIGHT = 800

export type ContextMenuGallerySceneProps = {
  harness: Harness
  brandHue: number
  darkMode: boolean
}

interface Stage {
  title: string
  caption: string
  menu: ContextMenuEntry[]
  menuWidth: number
  context: ReactNode
}

const FILE_TREE_DEMO = (
  <ContextDemoFrame
    width={520}
    label="apps/desktop/src/main"
    icon={<FolderOpen className="size-3.5" />}
  >
    <TreeRow depth={0} icon={<FolderOpen className="size-3.5 text-amber-500" />} name="agent" />
    <TreeRow depth={1} icon={<Folder className="size-3.5 text-amber-500/80" />} name="codex" />
    <TreeRow depth={1} icon={<FileCode className="size-3.5 text-sky-500" />} name="session.ts" />
    <TreeRow
      depth={1}
      icon={<FileCode className="size-3.5 text-sky-500" />}
      name="permission-handler.ts"
      gitStatus="M"
      highlight
      anchorMark
    />
    <TreeRow depth={1} icon={<FileCode className="size-3.5 text-sky-500" />} name="event-trace.ts" />
    <TreeRow depth={0} icon={<Folder className="size-3.5 text-amber-500/80" />} name="remote" />
    <TreeRow depth={0} icon={<FileCode className="size-3.5 text-sky-500" />} name="index.ts" />
  </ContextDemoFrame>
)

const FOLDER_DEMO = (
  <ContextDemoFrame
    width={520}
    label="apps/desktop/src/renderer"
    icon={<FolderOpen className="size-3.5" />}
  >
    <TreeRow depth={0} icon={<FolderOpen className="size-3.5 text-amber-500" />} name="src" />
    <TreeRow
      depth={1}
      icon={<Folder className="size-3.5 text-amber-500/80" />}
      name="components"
      highlight
      anchorMark
    />
    <TreeRow depth={1} icon={<Folder className="size-3.5 text-amber-500/80" />} name="hooks" />
    <TreeRow depth={1} icon={<Folder className="size-3.5 text-amber-500/80" />} name="stores" />
    <TreeRow depth={1} icon={<FileCode className="size-3.5 text-sky-500" />} name="App.tsx" />
    <TreeRow depth={1} icon={<File className="size-3.5 text-muted-foreground" />} name="main.tsx" />
  </ContextDemoFrame>
)

const PROJECT_DEMO = (
  <SidebarDemoFrame width={300} label="Projects">
    <ProjectListItem
      name="super-one"
      icon={<FolderOpen className="size-4.5 shrink-0 text-sidebar-foreground/70" />}
      highlight
      anchorMark
    />
    <ProjectListItem name="super-one-flutter" />
    <ProjectListItem name="super-one-relay" />
    <ProjectListItem name="marketing-site" />
  </SidebarDemoFrame>
)

const SESSION_DEMO = (
  <SidebarDemoFrame width={300} label="super-one">
    <ProjectListItem
      name="super-one"
      icon={<FolderOpen className="size-4.5 shrink-0 text-sidebar-foreground/70" />}
    />
    <SessionListItem
      title="Refactor sidebar layout"
      icon={<Loader2 className="size-3 animate-spin text-sidebar-foreground/70" />}
      active
    />
    <SessionListItem
      title="Fix relay reconnect bug"
      icon={<CircleCheck className="size-3 text-green-600 dark:text-green-400" />}
      highlight
      anchorMark
    />
    <SessionListItem
      title="Polish miniapp permissions"
      icon={<MessageSquare className="size-3 text-sidebar-foreground/70" />}
      pinned
    />
  </SidebarDemoFrame>
)

const AUTOMATION_DEMO = (
  <SidebarDemoFrame width={300} label="Automations">
    <AutomationListItem name="Nightly TypeCheck" enabled />
    <AutomationListItem name="Weekly Dep Audit" enabled highlight anchorMark />
    <AutomationListItem name="Release Drafter" enabled={false} />
  </SidebarDemoFrame>
)

const SELECTION_DEMO = (
  <ChatBubbleDemoFrame width={580}>
    <p>
      To reproduce the bug, open <SelText>apps/desktop/src/main/agent/session.ts</SelText> and look at
      the cwd guard around line 142 — it bails before <SelText anchorMark>persisting the rebuild flag</SelText>,
      so the next send picks up the old cwd. We should write a regression test that flips cwd mid-stream.
    </p>
  </ChatBubbleDemoFrame>
)

const FILE_QUOTE_DEMO = (
  <CodeBlockDemoFrame width={580} path="src/main/agent/session.ts">
    <CodeLine n={40} text="async send(input: AgentInput): Promise<void> {" />
    <CodeLine n={41} text="  const wasStreaming = this.streaming" />
    <CodeLine n={42} text="  if (this.cwd !== input.cwd) {" highlight />
    <CodeLine n={43} text="    this.pendingRebuild = true" highlight />
    <CodeLine n={44} text="  }" highlight anchorMark />
    <CodeLine n={45} text="  return this.backend.send(input)" />
    <CodeLine n={46} text="}" />
  </CodeBlockDemoFrame>
)

const IMAGE_DEMO = (
  <ImageDemoFrame width={420} caption="generated-by-codex.png">
    <div className="flex h-44 items-center justify-center bg-gradient-to-br from-amber-200 via-orange-300 to-rose-400 text-white">
      <div className="flex flex-col items-center gap-1">
        <ImageIcon className="size-8" />
        <span className="text-xs">codex · vivid · 1024×1024</span>
      </div>
    </div>
  </ImageDemoFrame>
)

const STAGES: Stage[] = [
  {
    title: "File row",
    caption:
      "Right-click any file in the sidebar — rename, add to chat, copy path, reveal in Finder, delete.",
    menu: FILE_ROW_CONTEXT_MENU,
    menuWidth: 200,
    context: FILE_TREE_DEMO,
  },
  {
    title: "Folder row",
    caption: "Folders share the same shape, with reveal-in-Finder swapped for the parent open.",
    menu: FOLDER_ROW_CONTEXT_MENU,
    menuWidth: 200,
    context: FOLDER_DEMO,
  },
  {
    title: "Project row",
    caption: "On a project in the sidebar — quick jump to its session history, or remove it.",
    menu: PROJECT_ROW_CONTEXT_MENU,
    menuWidth: 192,
    context: PROJECT_DEMO,
  },
  {
    title: "Session row",
    caption: "Sessions get the full kit — rename, pin, hide, mini-window, copy IDs, delete.",
    menu: SESSION_ROW_CONTEXT_MENU,
    menuWidth: 220,
    context: SESSION_DEMO,
  },
  {
    title: "Automation row",
    caption: "Run a scheduled automation on demand, jump to edit, or delete it.",
    menu: AUTOMATION_ROW_CONTEXT_MENU,
    menuWidth: 184,
    context: AUTOMATION_DEMO,
  },
  {
    title: "Text selection in chat",
    caption: "Select any prose in chat → right-click to copy it or fold it back as a quoted reply.",
    menu: TEXT_SELECTION_CONTEXT_MENU,
    menuWidth: 176,
    context: SELECTION_DEMO,
  },
  {
    title: "Quoted file lines",
    caption:
      "Selecting code in the file preview captures path + line range and quotes it cleanly into chat.",
    menu: FILE_QUOTE_CONTEXT_MENU,
    menuWidth: 240,
    context: FILE_QUOTE_DEMO,
  },
  {
    title: "Generated image",
    caption: "Codex image outputs get their own actions — send back, edit, copy, regenerate.",
    menu: IMAGE_CONTEXT_MENU,
    menuWidth: 208,
    context: IMAGE_DEMO,
  },
]

const STAGE_SECONDS = 3.2
export const CONTEXT_MENU_GALLERY_DURATION_IN_FRAMES =
  STAGES.length * STAGE_SECONDS * CONTEXT_MENU_GALLERY_FPS

export const contextMenuGallerySceneDefaultProps: ContextMenuGallerySceneProps = {
  harness: "claude",
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: true,
}

export const ContextMenuGalleryScene = ({
  brandHue,
  darkMode,
}: ContextMenuGallerySceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const idx = Math.min(STAGES.length - 1, Math.floor(t / STAGE_SECONDS))
  const stage = STAGES[idx]

  const localT = t - idx * STAGE_SECONDS
  const menuOpacity = interpolate(
    localT,
    [0, 0.25, STAGE_SECONDS - 0.25, STAGE_SECONDS],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )
  const menuScale = interpolate(localT, [0, 0.35], [0.92, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const rippleScale = interpolate(localT, [0, 0.5], [0.2, 1.4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const rippleOpacity = interpolate(localT, [0, 0.5], [0.7, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const shellOpacity = interpolate(frame, [0, 0.4 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="items-center justify-center bg-muted p-6">
        <div
          style={{ width: 1232, height: 752, opacity: shellOpacity }}
          className="relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl"
        >
          <div className="absolute inset-x-0 top-0 z-10 flex h-11 items-center gap-3 border-b border-border/60 bg-card/95 px-4 backdrop-blur">
            <div className="flex gap-1.5">
              <span className="size-3 rounded-full bg-rose-400/80" />
              <span className="size-3 rounded-full bg-amber-300/80" />
              <span className="size-3 rounded-full bg-emerald-400/80" />
            </div>
            <span className="text-[11px] text-muted-foreground">Context Menus</span>
            <div className="ml-auto rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-foreground">
              {stage.title}
            </div>
          </div>

          <AbsoluteFill className="top-11 flex items-center justify-center">
            <div className="relative">
              {stage.context}

              <div
                className="pointer-events-none absolute -right-2 top-0 z-20 translate-x-full"
                style={{
                  opacity: menuOpacity,
                  transform: `translateX(100%) scale(${menuScale})`,
                  transformOrigin: "top left",
                }}
              >
                <div className="ml-3">
                  <ContextMenuMock items={stage.menu} width={stage.menuWidth} />
                </div>
              </div>

              <div
                className="pointer-events-none absolute right-0 top-0 z-10"
                style={{ opacity: rippleOpacity }}
              >
                <div
                  className="size-6 rounded-full bg-primary/40 ring-2 ring-primary/70"
                  style={{ transform: `scale(${rippleScale})` }}
                />
              </div>
            </div>
          </AbsoluteFill>

          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 mx-auto flex max-w-3xl justify-center px-6">
            <div className="rounded-full bg-background/80 px-4 py-1.5 text-[11px] text-muted-foreground shadow-sm ring-1 ring-border/60 backdrop-blur">
              {stage.caption}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}

function ContextDemoFrame({
  width,
  label,
  icon,
  children,
}: {
  width: number
  label: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div
      style={{ width }}
      className="rounded-lg border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm"
    >
      <div className="flex items-center gap-1.5 border-b border-sidebar-border/60 px-3 py-2 text-[11px] uppercase tracking-wide text-sidebar-foreground/50">
        <span className="text-sidebar-foreground/70">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="flex flex-col py-1.5">{children}</div>
    </div>
  )
}

function SidebarDemoFrame({
  width,
  label,
  children,
}: {
  width: number
  label: string
  children: ReactNode
}) {
  return (
    <div
      style={{ width }}
      className="rounded-lg border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm"
    >
      <div className="flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-wide text-sidebar-foreground/50">
        <span>{label}</span>
        <span className="text-sidebar-foreground/30">↕</span>
      </div>
      <div className="flex flex-col px-1.5 pb-2">{children}</div>
    </div>
  )
}

function ChatBubbleDemoFrame({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div
      style={{ width }}
      className="rounded-lg border border-border bg-card p-5 text-sm leading-relaxed text-foreground shadow-sm"
    >
      <div className="mb-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Bot className="size-3.5" />
        <span>Assistant · 2:14 PM</span>
      </div>
      {children}
    </div>
  )
}

function CodeBlockDemoFrame({
  width,
  path,
  children,
}: {
  width: number
  path: string
  children: ReactNode
}) {
  return (
    <div
      style={{ width }}
      className="overflow-hidden rounded-lg border border-border bg-card text-sm shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5 text-[11px] text-muted-foreground">
        <Folder className="size-3.5" />
        <span className="font-mono">{path}</span>
      </div>
      <div className="bg-card font-mono text-[12px] leading-6">{children}</div>
    </div>
  )
}

function ImageDemoFrame({
  width,
  caption,
  children,
}: {
  width: number
  caption: string
  children: ReactNode
}) {
  return (
    <div
      style={{ width }}
      className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      {children}
      <div className="flex items-center justify-between px-3 py-2 text-[11px] text-muted-foreground">
        <span className="font-mono">{caption}</span>
        <span>Codex Image</span>
      </div>
    </div>
  )
}

function TreeRow({
  depth,
  icon,
  name,
  highlight = false,
  anchorMark = false,
  gitStatus,
}: {
  depth: number
  icon: ReactNode
  name: string
  highlight?: boolean
  anchorMark?: boolean
  gitStatus?: "M" | "A" | "D" | "?"
}) {
  return (
    <div
      className={`relative flex items-center gap-1.5 rounded-md py-1 pr-2 text-[13px] ${
        highlight ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground"
      }`}
      style={{ paddingLeft: 12 + depth * 14 }}
    >
      <span className="text-sidebar-foreground/80">{icon}</span>
      <span className="min-w-0 truncate">{name}</span>
      {gitStatus && (
        <span
          className={`ml-auto text-[10px] font-medium ${
            gitStatus === "M"
              ? "text-amber-600 dark:text-amber-400"
              : gitStatus === "A"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-500"
          }`}
        >
          {gitStatus}
        </span>
      )}
      {anchorMark && <RightClickAnchor />}
    </div>
  )
}

function ProjectListItem({
  name,
  icon = <Folder className="size-4.5 shrink-0 text-sidebar-foreground/70" />,
  highlight = false,
  anchorMark = false,
}: {
  name: string
  icon?: ReactNode
  highlight?: boolean
  anchorMark?: boolean
}) {
  return (
    <div
      className={`relative flex h-9 items-center gap-2 rounded-md px-2.5 text-[13px] ${
        highlight ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground"
      }`}
    >
      {icon}
      <span className="min-w-0 truncate">{name}</span>
      {anchorMark && <RightClickAnchor />}
    </div>
  )
}

function SessionListItem({
  title,
  icon,
  active = false,
  pinned = false,
  highlight = false,
  anchorMark = false,
}: {
  title: string
  icon: ReactNode
  active?: boolean
  pinned?: boolean
  highlight?: boolean
  anchorMark?: boolean
}) {
  return (
    <div
      className={`relative ml-5 flex items-center gap-2 rounded-md py-1.5 pl-2.5 pr-2 text-[13px] ${
        highlight
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : active
            ? "bg-sidebar-accent/70"
            : "text-sidebar-foreground"
      }`}
    >
      <span className="flex size-3 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {pinned && <Pin className="size-3 text-sidebar-foreground/50" />}
      {anchorMark && <RightClickAnchor />}
    </div>
  )
}

function AutomationListItem({
  name,
  enabled,
  highlight = false,
  anchorMark = false,
}: {
  name: string
  enabled: boolean
  highlight?: boolean
  anchorMark?: boolean
}) {
  return (
    <div
      className={`relative flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] ${
        highlight ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground"
      }`}
    >
      <CalendarClock className="size-3 shrink-0 text-sidebar-foreground/60" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span
        className={`size-1.5 rounded-full ${
          enabled ? "bg-green-500" : "bg-muted-foreground/40"
        }`}
      />
      {anchorMark && <RightClickAnchor />}
    </div>
  )
}

function CodeLine({
  n,
  text,
  highlight = false,
  anchorMark = false,
}: {
  n: number
  text: string
  highlight?: boolean
  anchorMark?: boolean
}) {
  return (
    <div
      className={`relative flex items-start gap-3 px-3 ${
        highlight ? "bg-primary/15" : ""
      }`}
    >
      <span className="w-6 select-none text-right text-muted-foreground/60">{n}</span>
      <span
        className={
          highlight
            ? "rounded-sm bg-primary/30 px-0.5 text-foreground"
            : "text-foreground"
        }
      >
        {text}
      </span>
      {anchorMark && <RightClickAnchor />}
    </div>
  )
}

function SelText({ children, anchorMark = false }: { children: ReactNode; anchorMark?: boolean }) {
  return (
    <span className="relative inline rounded-sm bg-primary/25 px-0.5 text-foreground">
      {children}
      {anchorMark && <RightClickAnchor />}
    </span>
  )
}

function RightClickAnchor() {
  return (
    <span className="pointer-events-none absolute right-1 top-1/2 inline-flex size-1.5 -translate-y-1/2 items-center justify-center">
      <span className="size-1.5 rounded-full bg-primary" />
    </span>
  )
}
