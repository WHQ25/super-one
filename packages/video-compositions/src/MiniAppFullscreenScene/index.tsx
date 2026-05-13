import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion"
import {
  BrandScope,
  ChatBody,
  HARNESS_CLAUDE_HUE,
  type Harness,
} from "@superone/desktop-mocks"
import {
  Bot,
  ChevronDown,
  Circle,
  Hand,
  Layers,
  Minimize2,
  MicOff,
  Moon,
  MousePointer2,
  Plus,
  Save,
  Square,
  Type as TypeIcon,
  Undo2,
  X,
  ZoomIn,
} from "lucide-react"
import type { CSSProperties, ReactNode } from "react"

export const MINIAPP_FULLSCREEN_FPS = 30
export const MINIAPP_FULLSCREEN_WIDTH = 1280
export const MINIAPP_FULLSCREEN_HEIGHT = 800
export const MINIAPP_FULLSCREEN_DURATION_IN_FRAMES = 16 * MINIAPP_FULLSCREEN_FPS

const SHELL_W = 1232
const SHELL_H = 752
const TITLEBAR_H = 44
const TOP_OFFSET = TITLEBAR_H + 8
const PANEL_OFFSET = 16
const COLLAPSED_SIZE = 48
const PANEL_W = 360
const PANEL_H = 540
const CHAT_HEADER_H = 36
const SIZE_EASE = Easing.bezier(0.32, 0.72, 0, 1)

const DRAG_EASE = Easing.bezier(0.22, 0.61, 0.36, 1)
const SNAP_EASE = Easing.bezier(0.34, 1.56, 0.64, 1)
const SNAP_REACH_AT = 0.7
const SNAP_HOLD_UNTIL = 0.82
const SNAP_DRAG_PCT = 0.86

export type Anchor = "tl" | "tm" | "tr" | "lm" | "rm" | "bl" | "bm" | "br"

export const ANCHORS: readonly Anchor[] = [
  "tl",
  "tm",
  "tr",
  "lm",
  "rm",
  "bl",
  "bm",
  "br",
] as const

const ANCHOR_LABEL: Record<Anchor, string> = {
  tl: "top-left",
  tm: "top-mid",
  tr: "top-right",
  lm: "left-mid",
  rm: "right-mid",
  bl: "bottom-left",
  bm: "bottom-mid",
  br: "bottom-right",
}

export function anchorPosition(
  anchor: Anchor,
  panelW: number,
  panelH: number,
  shellW: number = SHELL_W,
  shellH: number = SHELL_H,
): { x: number; y: number } {
  switch (anchor) {
    case "tl":
      return { x: PANEL_OFFSET, y: TOP_OFFSET }
    case "tr":
      return { x: shellW - PANEL_OFFSET - panelW, y: TOP_OFFSET }
    case "bl":
      return { x: PANEL_OFFSET, y: shellH - PANEL_OFFSET - panelH }
    case "br":
      return { x: shellW - PANEL_OFFSET - panelW, y: shellH - PANEL_OFFSET - panelH }
    case "tm":
      return { x: (shellW - panelW) / 2, y: TOP_OFFSET }
    case "bm":
      return { x: (shellW - panelW) / 2, y: shellH - PANEL_OFFSET - panelH }
    case "lm":
      return { x: PANEL_OFFSET, y: (shellH - panelH) / 2 }
    case "rm":
      return { x: shellW - PANEL_OFFSET - panelW, y: (shellH - panelH) / 2 }
  }
}

export type MiniAppFullscreenSceneProps = {
  harness: Harness
  brandHue: number
  darkMode: boolean
}

export const miniAppFullscreenSceneDefaultProps: MiniAppFullscreenSceneProps = {
  harness: "claude",
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

type DragPhase = "idle" | "drag" | "snap"

interface Keyframe {
  at: number
  anchor: Anchor
  expanded: number
  snapDots: number
  caption: string
  highlightHeader?: "close" | "minimize" | "title"
}

const SCRIPT: Keyframe[] = [
  { at: 0.0, anchor: "br", expanded: 0, snapDots: 0, caption: "" },
  {
    at: 1.0,
    anchor: "br",
    expanded: 0,
    snapDots: 0,
    caption: "Fullscreen mini-app — traffic lights · app icon · 3 controls",
    highlightHeader: "title",
  },
  {
    at: 1.8,
    anchor: "br",
    expanded: 0,
    snapDots: 0,
    caption: "Minimize2 returns the mini-app to a side panel",
    highlightHeader: "minimize",
  },
  {
    at: 2.5,
    anchor: "br",
    expanded: 0,
    snapDots: 0,
    caption: "X closes the mini-app entirely",
    highlightHeader: "close",
  },
  {
    at: 3.2,
    anchor: "br",
    expanded: 0,
    snapDots: 0,
    caption: "Floating chat lives over the mini-app — 48 px Bot bubble",
  },
  {
    at: 4.0,
    anchor: "br",
    expanded: 1,
    snapDots: 0,
    caption: "Click to expand — same panel as coding mode (header · scroll · input · status)",
  },
  { at: 6.2, anchor: "br", expanded: 1, snapDots: 0, caption: "" },
  {
    at: 7.0,
    anchor: "br",
    expanded: 0,
    snapDots: 0,
    caption: "Collapse back to the pill, then grab to drag",
  },
  {
    at: 7.6,
    anchor: "br",
    expanded: 0,
    snapDots: 1,
    caption: "8 magnetic snap points — 4 corners + 4 edge midpoints",
  },
  {
    at: 8.7,
    anchor: "bl",
    expanded: 0,
    snapDots: 1,
    caption: "Release near an anchor — the bubble snaps the last few pixels",
  },
  { at: 9.7, anchor: "tl", expanded: 0, snapDots: 1, caption: "" },
  {
    at: 10.7,
    anchor: "tm",
    expanded: 0,
    snapDots: 1,
    caption: "Edge midpoints work too",
  },
  { at: 11.7, anchor: "tr", expanded: 0, snapDots: 1, caption: "" },
  { at: 12.7, anchor: "rm", expanded: 0, snapDots: 1, caption: "" },
  { at: 13.7, anchor: "bm", expanded: 0, snapDots: 1, caption: "" },
  { at: 14.7, anchor: "lm", expanded: 0, snapDots: 1, caption: "" },
  {
    at: 15.4,
    anchor: "br",
    expanded: 0,
    snapDots: 0,
    caption: "Snap points fade after release — the chosen dock is remembered",
  },
  { at: 16.0, anchor: "br", expanded: 0, snapDots: 0, caption: "" },
]

interface ScriptState {
  expanded: number
  snapDots: number
  posX: number
  posY: number
  width: number
  height: number
  radius: number
  caption: string
  highlightHeader?: "close" | "minimize" | "title"
  targetAnchor: Anchor
  fromAnchor: Anchor
  dragPhase: DragPhase
  dragProgress: number
  snapPulse: number
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function pickStepKeyframe(tSec: number): Keyframe {
  let active = SCRIPT[0]
  for (const kf of SCRIPT) {
    if (tSec + 0.0001 >= kf.at) active = kf
  }
  return active
}

function sampleScript(tSec: number): ScriptState {
  let aIdx = 0
  for (let i = 0; i < SCRIPT.length - 1; i++) {
    if (tSec >= SCRIPT[i].at) aIdx = i
  }
  const a = SCRIPT[aIdx]
  const b = SCRIPT[Math.min(aIdx + 1, SCRIPT.length - 1)] ?? a
  const span = b.at - a.at
  const raw = span <= 0 ? 1 : clamp01((tSec - a.at) / span)

  const expanded = lerp(a.expanded, b.expanded, SIZE_EASE(raw))
  const snapDots = lerp(a.snapDots, b.snapDots, SIZE_EASE(raw))

  const wA = lerp(COLLAPSED_SIZE, PANEL_W, a.expanded)
  const hA = lerp(COLLAPSED_SIZE, PANEL_H, a.expanded)
  const wB = lerp(COLLAPSED_SIZE, PANEL_W, b.expanded)
  const hB = lerp(COLLAPSED_SIZE, PANEL_H, b.expanded)

  const width = lerp(wA, wB, SIZE_EASE(raw))
  const height = lerp(hA, hB, SIZE_EASE(raw))
  const radius = lerp(COLLAPSED_SIZE / 2, 16, expanded)

  const posA = anchorPosition(a.anchor, wA, hA)
  const posB = anchorPosition(b.anchor, wB, hB)

  let posProgress: number
  let dragPhase: DragPhase = "idle"
  let snapPulse = 0

  if (a.anchor === b.anchor) {
    posProgress = SIZE_EASE(raw)
    dragPhase = "idle"
  } else if (raw < SNAP_REACH_AT) {
    const dragP = raw / SNAP_REACH_AT
    posProgress = DRAG_EASE(dragP) * SNAP_DRAG_PCT
    dragPhase = "drag"
  } else if (raw < SNAP_HOLD_UNTIL) {
    posProgress = SNAP_DRAG_PCT
    dragPhase = "drag"
  } else {
    const snapP = clamp01((raw - SNAP_HOLD_UNTIL) / (1 - SNAP_HOLD_UNTIL))
    posProgress = SNAP_DRAG_PCT + SNAP_EASE(snapP) * (1 - SNAP_DRAG_PCT)
    dragPhase = "snap"
    snapPulse = 1 - snapP
  }

  const posX = lerp(posA.x, posB.x, posProgress)
  const posY = lerp(posA.y, posB.y, posProgress)

  const stepKf = pickStepKeyframe(tSec)

  return {
    expanded,
    snapDots,
    posX,
    posY,
    width,
    height,
    radius,
    caption: stepKf.caption,
    highlightHeader: stepKf.highlightHeader,
    targetAnchor: b.anchor,
    fromAnchor: a.anchor,
    dragPhase,
    dragProgress: dragPhase === "drag" ? clamp01(raw / SNAP_HOLD_UNTIL) : 1,
    snapPulse,
  }
}

export const MiniAppFullscreenScene = ({
  brandHue,
  darkMode,
  harness,
}: MiniAppFullscreenSceneProps) => {
  const frame = useCurrentFrame()
  const t = frame / MINIAPP_FULLSCREEN_FPS
  const state = sampleScript(t)

  const shellOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="items-center justify-center bg-muted p-6">
        <div
          style={{
            width: SHELL_W,
            height: SHELL_H,
            opacity: shellOpacity,
          }}
          className="relative overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl"
        >
          <MiniAppFullscreenShell highlight={state.highlightHeader} />

          <SnapPointGrid
            opacity={state.snapDots}
            activeAnchor={state.targetAnchor}
            dragPhase={state.dragPhase}
            snapPulse={state.snapPulse}
            dragProgress={state.dragProgress}
          />

          <FloatingChatPanel
            harness={harness}
            x={state.posX}
            y={state.posY}
            width={state.width}
            height={state.height}
            radius={state.radius}
            expanded={state.expanded}
            dragging={state.dragPhase === "drag"}
          />

          <Caption text={state.caption} />
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}

/* ---------------------------------------------------------------------------
 * Reusable: full-screen mini-app shell (titlebar + workspace body)
 * ------------------------------------------------------------------------- */

export interface MiniAppFullscreenShellProps {
  appName?: string
  appVersion?: string
  highlight?: "close" | "minimize" | "title"
  children?: ReactNode
}

export function MiniAppFullscreenShell({
  appName = "Canvas",
  appVersion = "v0.4.2",
  highlight,
  children,
}: MiniAppFullscreenShellProps) {
  return (
    <div className="flex h-full flex-col">
      <MiniAppHeader appName={appName} highlight={highlight} />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        {children ?? <FullscreenMiniAppBody appName={appName} appVersion={appVersion} />}
      </div>
    </div>
  )
}

export interface MiniAppHeaderProps {
  appName: string
  highlight?: "close" | "minimize" | "title"
}

export function MiniAppHeader({ appName, highlight }: MiniAppHeaderProps) {
  return (
    <div
      className="relative flex shrink-0 items-center bg-card pl-[18px] pr-3 pt-[2px]"
      style={{ height: TITLEBAR_H }}
    >
      <TrafficLights />
      <div className="ml-3 shrink-0" style={{ width: 12 }} />
      <HeaderAppTitle name={appName} highlighted={highlight === "title"} />
      <div className="flex-1" />
      <div className="flex items-center gap-1.5">
        <HeaderIconButton title="Media bridge active">
          <MicOff className="size-3.5" />
        </HeaderIconButton>
        <HeaderIconButton
          title="Return to panel"
          highlighted={highlight === "minimize"}
        >
          <Minimize2 className="size-3.5" />
        </HeaderIconButton>
        <HeaderIconButton title="Close mini-app" highlighted={highlight === "close"}>
          <X className="size-3.5" />
        </HeaderIconButton>
        <span className="mx-1 h-4 w-px bg-border/60" />
        <HeaderIconButton title="Toggle theme">
          <Moon className="size-3.5" />
        </HeaderIconButton>
      </div>
    </div>
  )
}

function HeaderAppTitle({ name, highlighted }: { name: string; highlighted: boolean }) {
  return (
    <div
      className={`flex max-w-[260px] items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground ${
        highlighted ? "bg-primary/15 text-foreground ring-1 ring-primary/40" : ""
      }`}
    >
      <AppIcon />
      <span className="truncate">{name}</span>
      <span className="text-[10px] text-muted-foreground/60">— super-one</span>
    </div>
  )
}

function AppIcon() {
  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center rounded-sm bg-gradient-to-br from-violet-400 via-fuchsia-400 to-amber-300 text-[8px] font-bold text-white shadow-sm">
      C
    </span>
  )
}

function HeaderIconButton({
  children,
  highlighted,
}: {
  children: ReactNode
  title: string
  highlighted?: boolean
}) {
  return (
    <span
      className={`relative inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/70 ${
        highlighted ? "bg-primary/20 text-foreground ring-1 ring-primary/50" : ""
      }`}
    >
      {children}
      {highlighted && (
        <span className="pointer-events-none absolute -inset-1 rounded-md ring-2 ring-primary/30" />
      )}
    </span>
  )
}

function TrafficLights() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="size-3 rounded-full bg-[#ff5f57] ring-1 ring-inset ring-black/10" />
      <span className="size-3 rounded-full bg-[#febc2e] ring-1 ring-inset ring-black/10" />
      <span className="size-3 rounded-full bg-[#28c840] ring-1 ring-inset ring-black/10" />
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Reusable: a stylised "Canvas" mini-app workspace as the body of the shell
 * ------------------------------------------------------------------------- */

export interface FullscreenMiniAppBodyProps {
  appName?: string
  appVersion?: string
}

export function FullscreenMiniAppBody({
  appName = "Canvas",
  appVersion = "v0.4.2",
}: FullscreenMiniAppBodyProps) {
  return (
    <div className="flex h-full flex-col">
      <MiniAppToolbar appName={appName} appVersion={appVersion} />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <MiniAppCanvas />
        <MiniAppInspector />
      </div>
      <MiniAppStatusBar />
    </div>
  )
}

function MiniAppToolbar({
  appName,
  appVersion,
}: {
  appName: string
  appVersion: string
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/40 bg-muted/40 px-3 text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <AppIcon />
        <span className="text-foreground/80">{appName}</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="text-muted-foreground/60">untitled-canvas.s1canvas</span>
      </span>
      <span className="mx-2 h-4 w-px bg-border/60" />
      <ToolbarBtn>
        <MousePointer2 className="size-3.5" />
      </ToolbarBtn>
      <ToolbarBtn active>
        <Hand className="size-3.5" />
      </ToolbarBtn>
      <ToolbarBtn>
        <Square className="size-3.5" />
      </ToolbarBtn>
      <ToolbarBtn>
        <Circle className="size-3.5" />
      </ToolbarBtn>
      <ToolbarBtn>
        <TypeIcon className="size-3.5" />
      </ToolbarBtn>
      <span className="mx-2 h-4 w-px bg-border/60" />
      <ToolbarBtn>
        <Undo2 className="size-3.5" />
      </ToolbarBtn>
      <ToolbarBtn>
        <Save className="size-3.5" />
      </ToolbarBtn>
      <div className="flex-1" />
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <ZoomIn className="size-3" />
        125%
      </span>
      <span className="text-[11px] text-muted-foreground/60">{appVersion}</span>
    </div>
  )
}

function ToolbarBtn({
  children,
  active,
}: {
  children: ReactNode
  active?: boolean
}) {
  return (
    <span
      className={`inline-flex size-7 items-center justify-center rounded-md ${
        active
          ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
          : "text-muted-foreground/70"
      }`}
    >
      {children}
    </span>
  )
}

function MiniAppCanvas() {
  const gridStyle: CSSProperties = {
    backgroundImage:
      "radial-gradient(circle, color-mix(in oklch, var(--foreground) 15%, transparent) 1px, transparent 1px)",
    backgroundSize: "28px 28px",
  }
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/8 via-fuchsia-500/8 to-amber-400/8" />
      <div className="absolute inset-0 opacity-50" style={gridStyle} />
      <CanvasEdge fromX={32} fromY={42} toX={56} toY={62} />
      <CanvasEdge fromX={70} fromY={36} toX={56} toY={62} />
      <CanvasNode
        x={28}
        y={32}
        title="Source"
        subtitle="postgres://..."
        color="from-violet-400 to-indigo-500"
      />
      <CanvasNode
        x={66}
        y={26}
        title="Transform"
        subtitle="filter · join"
        color="from-amber-300 to-rose-400"
      />
      <CanvasNode
        x={52}
        y={56}
        title="Sink"
        subtitle="3 outputs"
        color="from-emerald-300 to-cyan-500"
        selected
      />
      <div className="absolute bottom-6 left-6 flex items-center gap-2 rounded-full bg-background/80 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm ring-1 ring-border/60 backdrop-blur">
        <Layers className="size-3" />
        3 nodes · 2 connections
      </div>
    </div>
  )
}

function CanvasNode({
  x,
  y,
  title,
  subtitle,
  color,
  selected,
}: {
  x: number
  y: number
  title: string
  subtitle: string
  color: string
  selected?: boolean
}) {
  return (
    <div
      className={`absolute flex w-[180px] flex-col gap-1 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur ${
        selected ? "border-primary/60 ring-2 ring-primary/30" : "border-border/60"
      }`}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex size-6 items-center justify-center rounded-md bg-gradient-to-br ${color} text-white`}
        >
          <Circle className="size-3" />
        </span>
        <span className="truncate text-xs font-medium text-foreground">{title}</span>
      </div>
      <span className="truncate text-[10px] text-muted-foreground">{subtitle}</span>
      <div className="mt-1 flex items-center justify-between text-[9px] text-muted-foreground/70">
        <span>in: 1</span>
        <span>out: 1</span>
      </div>
    </div>
  )
}

function CanvasEdge({
  fromX,
  fromY,
  toX,
  toY,
}: {
  fromX: number
  fromY: number
  toX: number
  toY: number
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ overflow: "visible" }}
      preserveAspectRatio="none"
    >
      <path
        d={`M ${fromX}% ${fromY}% C ${(fromX + toX) / 2}% ${fromY}%, ${(fromX + toX) / 2}% ${toY}%, ${toX}% ${toY}%`}
        fill="none"
        stroke="color-mix(in oklch, var(--primary) 60%, transparent)"
        strokeWidth={2}
        strokeDasharray="4 4"
      />
    </svg>
  )
}

function MiniAppInspector() {
  return (
    <div className="hidden w-[200px] shrink-0 flex-col border-l border-border/40 bg-muted/30 p-3 text-[11px] text-muted-foreground @[1200px]:flex">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
        Inspector
      </span>
      <span className="mt-1 text-foreground">Sink</span>
      <span className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground/60">
        Properties
      </span>
      <PropRow label="format" value="parquet" />
      <PropRow label="outputs" value="3" />
      <PropRow label="ttl" value="7d" />
    </div>
  )
}

function PropRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1 flex items-center justify-between border-b border-border/30 py-1">
      <span>{label}</span>
      <span className="font-mono text-[10px] text-foreground">{value}</span>
    </div>
  )
}

function MiniAppStatusBar() {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-t border-border/40 bg-card/80 px-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Bridge connected
      </span>
      <span>Idle · auto-saved 2s ago</span>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Reusable: floating chat panel — 1:1 with the real desktop ChatPanel
 * Collapsed = 48 px Bot pill (matches CollapsedChatPanelView)
 * Expanded  = 360 × 540 panel with chevron header + ChatBody from desktop-mocks
 * ------------------------------------------------------------------------- */

export interface FloatingChatPanelProps {
  harness: Harness
  x: number
  y: number
  width: number
  height: number
  radius: number
  expanded: number
  dragging?: boolean
  title?: string
}

export function FloatingChatPanel({
  harness,
  x,
  y,
  width,
  height,
  radius,
  expanded,
  dragging = false,
  title = "Polish the canvas grid",
}: FloatingChatPanelProps) {
  const headerOpacity = clamp01((expanded - 0.55) / 0.3)
  const bodyOpacity = clamp01((expanded - 0.65) / 0.25)
  const collapsedOpacity = clamp01(1 - expanded * 1.8)
  const showHeader = headerOpacity > 0.01
  const showBody = bodyOpacity > 0.01
  const showCollapsed = collapsedOpacity > 0.01

  return (
    <div
      className={`absolute z-30 flex flex-col overflow-hidden border border-border bg-card shadow-2xl ${
        dragging ? "ring-2 ring-primary/40" : ""
      }`}
      style={{
        left: x,
        top: y,
        width,
        height,
        borderRadius: radius,
      }}
    >
      {showCollapsed && (
        <CollapsedChatBubble opacity={collapsedOpacity} />
      )}

      {showHeader && (
        <div
          className="flex shrink-0 select-none items-center gap-2 bg-card px-3 pt-[2px]"
          style={{ height: CHAT_HEADER_H, opacity: headerOpacity }}
        >
          <span className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground/60">
            <ChevronDown className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate pr-3 text-xs text-muted-foreground">
            {title}
          </span>
          <span className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground/60">
            <Plus className="size-3.5" />
          </span>
        </div>
      )}

      {showBody && (
        <div
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-card"
          style={{ opacity: bodyOpacity }}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-linear-to-b from-card to-transparent" />
          <ChatBody
            harness={harness}
            messages={FLOATING_CHAT_MESSAGES}
            showFooter={false}
            autoScroll={false}
          />
        </div>
      )}
    </div>
  )
}

const FLOATING_CHAT_MESSAGES = [
  {
    id: "u1",
    role: "user" as const,
    text: "Make the canvas grid snap to 28 px and dim slightly when zooming out.",
  },
  {
    id: "a1",
    role: "assistant" as const,
    blocks: [
      {
        type: "markdown" as const,
        text: `I'll bump the radial-gradient to 28 px and tie opacity to the current zoom level.

\`\`\`tsx
const gridStyle = {
  backgroundImage: \`radial-gradient(circle,
    color-mix(in oklch, var(--foreground) \${15 * zoom}%, transparent) 1px,
    transparent 1px)\`,
  backgroundSize: \`\${28 * zoom}px \${28 * zoom}px\`,
}
\`\`\`

Done — 1 file changed, 4 lines updated. Want a snap-to-grid toggle next?`,
      },
    ],
  },
]

function CollapsedChatBubble({ opacity }: { opacity: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center bg-card"
      style={{ opacity }}
    >
      <Bot className="size-5 text-foreground/80" />
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Reusable: 8 magnetic snap-point dots with drag/snap halo
 * ------------------------------------------------------------------------- */

export interface SnapPointGridProps {
  opacity: number
  activeAnchor?: Anchor
  dragPhase?: DragPhase
  dragProgress?: number
  snapPulse?: number
  shellW?: number
  shellH?: number
}

export function SnapPointGrid({
  opacity,
  activeAnchor,
  dragPhase = "idle",
  dragProgress = 0,
  snapPulse = 0,
  shellW = SHELL_W,
  shellH = SHELL_H,
}: SnapPointGridProps) {
  if (opacity <= 0.01) return null
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20"
      style={{ opacity }}
    >
      {ANCHORS.map((anchor) => {
        const { x, y } = anchorPosition(anchor, COLLAPSED_SIZE, COLLAPSED_SIZE, shellW, shellH)
        const cx = x + COLLAPSED_SIZE / 2
        const cy = y + COLLAPSED_SIZE / 2
        const isActive = anchor === activeAnchor
        return (
          <SnapDot
            key={anchor}
            cx={cx}
            cy={cy}
            label={ANCHOR_LABEL[anchor]}
            active={isActive}
            dragPhase={isActive ? dragPhase : "idle"}
            dragProgress={isActive ? dragProgress : 0}
            snapPulse={isActive ? snapPulse : 0}
          />
        )
      })}
    </div>
  )
}

function SnapDot({
  cx,
  cy,
  label,
  active,
  dragPhase,
  dragProgress,
  snapPulse,
}: {
  cx: number
  cy: number
  label: string
  active: boolean
  dragPhase: DragPhase
  dragProgress: number
  snapPulse: number
}) {
  const baseSize = 12
  const activeSize = 18
  const size = active ? activeSize : baseSize
  const haloOpacity = active ? Math.min(1, dragProgress * 0.45 + snapPulse * 0.7) : 0
  const haloScale = active ? 1.3 + dragProgress * 0.4 + snapPulse * 1.8 : 1
  return (
    <div className="absolute" style={{ left: cx - size / 2, top: cy - size / 2 }}>
      {active && (
        <span
          className="pointer-events-none absolute inset-0 rounded-full bg-primary/40"
          style={{
            transform: `scale(${haloScale})`,
            opacity: haloOpacity,
          }}
        />
      )}
      <div
        className={`relative flex items-center justify-center rounded-full ${
          active
            ? "bg-primary/30 ring-2 ring-primary"
            : "bg-foreground/10 ring-1 ring-foreground/25"
        }`}
        style={{ width: size, height: size }}
      >
        <span
          className={`block rounded-full ${active ? "bg-primary" : "bg-foreground/40"}`}
          style={{ width: size / 3, height: size / 3 }}
        />
      </div>
      {active && (
        <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-background/85 px-2 py-0.5 text-[9px] text-muted-foreground shadow-sm ring-1 ring-border/60 backdrop-blur">
          {label}
          {dragPhase === "snap" && <span className="ml-1 text-primary">↳ snap</span>}
        </span>
      )}
    </div>
  )
}

function Caption({ text }: { text: string }) {
  if (!text) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-40 mx-auto flex max-w-3xl justify-center px-6">
      <div className="rounded-full bg-background/85 px-4 py-1.5 text-[11px] text-muted-foreground shadow-sm ring-1 ring-border/60 backdrop-blur">
        {text}
      </div>
    </div>
  )
}
