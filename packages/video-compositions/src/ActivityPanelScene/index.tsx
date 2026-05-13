import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion"
import {
  BrandScope,
  ChatBody,
  DesktopSidebar,
  HARNESS_CLAUDE_HUE,
  type Harness,
  type MockProject,
} from "@superone/desktop-mocks"
import {
  Bot,
  Layout,
  Maximize,
  MessageSquare,
  Moon,
  PanelLeftDashed,
  PanelLeftOpen,
  PanelRightOpen,
  FileCode,
  X,
} from "lucide-react"

export const ACTIVITY_PANEL_FPS = 30
export const ACTIVITY_PANEL_WIDTH = 1280
export const ACTIVITY_PANEL_HEIGHT = 800

export type ActivityPanelSceneProps = {
  harness: Harness
  brandHue: number
  darkMode: boolean
}

const SHELL_W = 1232
const SHELL_H = 752
const SIDEBAR_W = 280
const AP_W = 480

const MOCK_PROJECTS: MockProject[] = [
  {
    name: "super-one",
    active: true,
    expanded: true,
    sessions: [
      { id: "s1", title: "Refactor sidebar layout", active: true, status: "running" },
      { id: "s2", title: "Fix relay reconnect bug", status: "unseen", pendingReason: "Allow Bash?" },
      { id: "s3", title: "Polish miniapp permissions", status: "unseen" },
      { id: "s4", title: "Worktree merge experiment", status: "worktree" },
    ],
  },
  { name: "marketing-site" },
  { name: "experiments" },
]

interface Keyframe {
  at: number
  sidebar: number
  panel: number
  side: number
  caption: string
}

const SCRIPT: Keyframe[] = [
  { at: 0.0, sidebar: 1, panel: 0, side: 0, caption: "Sidebar + chat — no activity panel yet" },
  { at: 1.4, sidebar: 1, panel: 0, side: 0, caption: "Open a file or mini-app to bring up the activity panel…" },
  { at: 2.2, sidebar: 1, panel: 1, side: 0, caption: "Activity panel docked on the right" },
  { at: 3.6, sidebar: 1, panel: 1, side: 0, caption: "Active mini-app tab shows the fullscreen icon" },
  { at: 4.6, sidebar: 1, panel: 1, side: 0, caption: "Hover a tab to reveal its close button" },
  { at: 5.6, sidebar: 1, panel: 1, side: 0, caption: "Toggle the chat side — chat slides to the right" },
  { at: 6.6, sidebar: 1, panel: 1, side: 1, caption: "Activity panel now leftmost, chat on the right" },
  { at: 8.0, sidebar: 1, panel: 1, side: 1, caption: "Collapse the sidebar with ⌘B" },
  { at: 9.0, sidebar: 0, panel: 1, side: 1, caption: "Layout toggles relocate to the activity panel header" },
  { at: 10.4, sidebar: 0, panel: 1, side: 1, caption: "Bring the sidebar back" },
  { at: 11.4, sidebar: 1, panel: 1, side: 1, caption: "Close the activity panel" },
  { at: 12.4, sidebar: 1, panel: 0, side: 1, caption: "Back to chat-only" },
  { at: 13.4, sidebar: 1, panel: 0, side: 1, caption: "" },
]

const EASE = Easing.bezier(0.4, 0, 0.2, 1)

function sampleScript(tSec: number, key: "sidebar" | "panel" | "side"): number {
  for (let i = 0; i < SCRIPT.length - 1; i++) {
    const a = SCRIPT[i]
    const b = SCRIPT[i + 1]
    if (tSec >= a.at && tSec <= b.at) {
      return interpolate(tSec, [a.at, b.at], [a[key], b[key]], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: EASE,
      })
    }
  }
  return SCRIPT[SCRIPT.length - 1][key]
}

function currentCaption(tSec: number): string {
  let active = SCRIPT[0]
  for (const kf of SCRIPT) {
    if (tSec + 0.0001 >= kf.at) active = kf
  }
  return active.caption
}

export const ACTIVITY_PANEL_DURATION_IN_FRAMES = Math.ceil(
  SCRIPT[SCRIPT.length - 1].at * ACTIVITY_PANEL_FPS,
)

export const activityPanelSceneDefaultProps: ActivityPanelSceneProps = {
  harness: "claude",
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: true,
}

export const ActivityPanelScene = ({ brandHue, darkMode, harness }: ActivityPanelSceneProps) => {
  const frame = useCurrentFrame()
  const t = frame / ACTIVITY_PANEL_FPS

  const sidebarOpen = sampleScript(t, "sidebar")
  const panelOpen = sampleScript(t, "panel")
  const side = sampleScript(t, "side")

  const shellOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const sidebarW = sidebarOpen * SIDEBAR_W
  const apW = panelOpen * AP_W
  const apLeft = interpolate(side, [0, 1], [SHELL_W - AP_W, sidebarW], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  const chatLeft = interpolate(side, [0, 1], [sidebarW, sidebarW + apW], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  const chatRight = interpolate(side, [0, 1], [SHELL_W - apW, SHELL_W], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  })
  const chatW = Math.max(0, chatRight - chatLeft)

  const sidebarLeftmost = sidebarOpen > 0.5
  const apLeftmost = !sidebarLeftmost && side > 0.5 && panelOpen > 0.5
  const chatLeftmost = !sidebarLeftmost && !apLeftmost

  const hoverWindow = t >= 4.6 && t <= 5.5
  const caption = currentCaption(t)
  const sideIsLeft = side > 0.5

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="items-center justify-center bg-muted p-6">
        <div
          style={{ width: SHELL_W, height: SHELL_H, opacity: shellOpacity }}
          className="relative overflow-hidden rounded-2xl border border-border/60 bg-sidebar shadow-2xl"
        >
          <div
            className="absolute inset-y-0 left-0 overflow-hidden bg-sidebar"
            style={{ width: sidebarW, opacity: sidebarOpen }}
          >
            <div style={{ width: SIDEBAR_W }} className="h-full">
              <DesktopSidebar
                projects={MOCK_PROJECTS}
                sidebarTab="sessions"
                showTrafficLights
                showActivityPanelToggle={panelOpen > 0.5 && sidebarLeftmost}
                layoutToggleSide={sideIsLeft ? "left" : "right"}
                width={SIDEBAR_W}
              />
            </div>
          </div>

          <ActivityPanelMock
            left={apLeft}
            width={apW}
            height={SHELL_H}
            sideIsLeft={sideIsLeft}
            visible={panelOpen}
            showLayoutToggles={apLeftmost}
            hoverFileTab={hoverWindow}
            panelOpen={panelOpen}
            sidebarOpen={sidebarOpen}
          />

          <ChatColumn
            harness={harness}
            left={chatLeft}
            width={chatW}
            height={SHELL_H}
            showLayoutToggles={chatLeftmost}
            panelOpen={panelOpen}
            sidebarOpen={sidebarOpen}
            sideIsLeft={sideIsLeft}
          />

          <div className="pointer-events-none absolute left-[18px] top-[18px] z-40">
            <TrafficLightsOverlay />
          </div>

          <Caption text={caption} />
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}

function ChatColumn({
  harness,
  left,
  width,
  height,
  showLayoutToggles,
  panelOpen,
  sidebarOpen,
  sideIsLeft,
}: {
  harness: Harness
  left: number
  width: number
  height: number
  showLayoutToggles: boolean
  panelOpen: number
  sidebarOpen: number
  sideIsLeft: boolean
}) {
  const onLeftEdge = sidebarOpen < 0.5 && (panelOpen < 0.5 || !sideIsLeft)
  const padLeft = onLeftEdge ? 84 : 16
  return (
    <div className="absolute top-0 bg-card" style={{ left, width, height }}>
      <div
        className="flex h-11 shrink-0 items-center"
        style={{ paddingLeft: padLeft, paddingRight: 14 }}
      >
        {showLayoutToggles && (
          <LayoutTogglesMock panelOpen={panelOpen} sideIsLeft={sideIsLeft} />
        )}
        <span className="max-w-[260px] truncate text-xs text-muted-foreground">
          super-one — main
        </span>
        <div className="flex-1" />
        <Moon className="size-3.5 text-muted-foreground/60" />
      </div>
      <div className="h-[calc(100%-44px)] overflow-hidden">
        <ChatBody harness={harness} showFooter={false} />
      </div>
    </div>
  )
}

function ActivityPanelMock({
  left,
  width,
  height,
  sideIsLeft,
  visible,
  showLayoutToggles,
  hoverFileTab,
  panelOpen,
  sidebarOpen,
}: {
  left: number
  width: number
  height: number
  sideIsLeft: boolean
  visible: number
  showLayoutToggles: boolean
  hoverFileTab: boolean
  panelOpen: number
  sidebarOpen: number
}) {
  const onLeftEdge = sideIsLeft && sidebarOpen < 0.5
  const wrapperRounded = sideIsLeft ? "" : "rounded-l-2xl"
  return (
    <div
      className="absolute top-0 overflow-hidden bg-sidebar"
      style={{ left, width, height, opacity: visible }}
    >
      <div
        className={`flex h-full flex-col overflow-hidden bg-background ${wrapperRounded}`}
        style={{ width: AP_W }}
      >
        <div
          className="flex h-11 shrink-0 items-center gap-1 border-b border-border/40 pr-2"
          style={{ paddingLeft: onLeftEdge ? 84 : 8 }}
        >
          {showLayoutToggles && (
            <div className="mr-1">
              <LayoutTogglesMock panelOpen={panelOpen} sideIsLeft={sideIsLeft} />
            </div>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            <FileTab name="activity-panel.ts" hovered={hoverFileTab} />
            <MiniAppTab name="Canvas" active />
            <SessionHistoryTab name="History" />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
          <MiniAppBody />
        </div>
      </div>
    </div>
  )
}

function FileTab({ name, hovered }: { name: string; hovered: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-muted-foreground transition-colors">
      <span className="relative flex size-3.5 shrink-0 items-center justify-center">
        {hovered ? (
          <span className="flex size-3.5 items-center justify-center rounded-full bg-foreground/15 text-foreground/80">
            <X className="size-2.5" strokeWidth={2.5} />
          </span>
        ) : (
          <FileCode className="size-3.5 text-sky-500" />
        )}
      </span>
      <span className="truncate text-xs">{name}</span>
    </div>
  )
}

function MiniAppTab({ name, active }: { name: string; active: boolean }) {
  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors ${
        active ? "bg-muted text-foreground" : "text-muted-foreground"
      }`}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center rounded-sm bg-gradient-to-br from-violet-400 to-rose-400 text-[8px] font-bold text-white">
        C
      </span>
      <span className="truncate text-xs">{name}</span>
      {active && (
        <span className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-foreground/60">
          <Maximize className="size-3" />
        </span>
      )}
    </div>
  )
}

function SessionHistoryTab({ name }: { name: string }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-muted-foreground">
      <MessageSquare className="size-3.5 shrink-0" />
      <span className="truncate text-xs">{name}</span>
    </div>
  )
}

function MiniAppBody() {
  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/30 bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="flex size-3.5 items-center justify-center rounded-sm bg-gradient-to-br from-violet-400 to-rose-400 text-[8px] font-bold text-white">
            C
          </span>
          Canvas
        </span>
        <span>Mini-app · v0.4.2</span>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-500/15 via-fuchsia-500/15 to-amber-500/15">
        <div className="absolute inset-0">
          <SparkleBlob x={28} y={32} hue="from-amber-300 to-rose-400" size={120} />
          <SparkleBlob x={62} y={56} hue="from-violet-400 to-cyan-400" size={84} />
          <SparkleBlob x={18} y={68} hue="from-emerald-400 to-sky-400" size={56} />
        </div>
        <div className="relative z-10 flex flex-col items-center gap-2 text-center text-foreground/80">
          <Layout className="size-8 opacity-60" />
          <span className="text-sm font-medium">Canvas workspace</span>
          <span className="text-[11px] text-muted-foreground">3 nodes · 2 connections</span>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-border/30 bg-background/80 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Bot className="size-3" />
          Bridged
        </span>
        <span>Idle</span>
      </div>
    </div>
  )
}

function SparkleBlob({ x, y, hue, size }: { x: number; y: number; hue: string; size: number }) {
  return (
    <div
      className={`absolute rounded-full bg-gradient-to-br ${hue} blur-2xl`}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: size,
        height: size,
        opacity: 0.7,
      }}
    />
  )
}

function LayoutTogglesMock({
  panelOpen,
  sideIsLeft,
}: {
  panelOpen: number
  sideIsLeft: boolean
}) {
  return (
    <div className="flex items-center gap-0.5">
      <button className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        <PanelLeftDashed className="size-3.5" />
      </button>
      {panelOpen > 0.5 && (
        <button className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          {sideIsLeft ? <PanelLeftOpen className="size-3.5" /> : <PanelRightOpen className="size-3.5" />}
        </button>
      )}
    </div>
  )
}

function TrafficLightsOverlay() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="size-3 rounded-full bg-[#ff5f57] ring-1 ring-inset ring-black/10" />
      <span className="size-3 rounded-full bg-[#febc2e] ring-1 ring-inset ring-black/10" />
      <span className="size-3 rounded-full bg-[#28c840] ring-1 ring-inset ring-black/10" />
    </div>
  )
}

function Caption({ text }: { text: string }) {
  if (!text) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 mx-auto flex max-w-3xl justify-center px-6">
      <div className="rounded-full bg-background/80 px-4 py-1.5 text-[11px] text-muted-foreground shadow-sm ring-1 ring-border/60 backdrop-blur">
        {text}
      </div>
    </div>
  )
}
