import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import {
  BrandScope,
  DesktopSidebar,
  FileTreeMock,
  HARNESS_CLAUDE_HUE,
  SAMPLE_FILE_TREE,
  type DesktopSidebarProps,
  type MockProject,
} from "@superone/desktop-mocks"

export const SIDEBAR_GALLERY_FPS = 30
export const SIDEBAR_GALLERY_WIDTH = 1280
export const SIDEBAR_GALLERY_HEIGHT = 800

export type SidebarGallerySceneProps = {
  brandHue: number
  darkMode: boolean
}

export const sidebarGallerySceneDefaultProps: SidebarGallerySceneProps = {
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

const COLLAPSED_PROJECTS: MockProject[] = [
  { name: "super-one", active: true },
  { name: "marketing-site" },
  { name: "experiments" },
  { name: "relay" },
]

const MISSING_PROJECTS: MockProject[] = [
  { name: "old-prototype", missing: true },
  { name: "archived-spike", missing: true },
]

interface Stage {
  title: string
  caption: string
  props: Partial<DesktopSidebarProps>
}

const STAGES: Stage[] = [
  {
    title: "Full sidebar",
    caption:
      "Pinned sessions and seven live status icons. Automations group under super-one; mini-app background workers under marketing-site — each feature on its own project.",
    props: {},
  },
  {
    title: "Apps drawer expanded",
    caption:
      "The app drawer opens to the full list — Dev badge, number hotkeys, fullscreen affordance, plus Marketplace / Build Your Own.",
    props: { appsExpanded: true },
  },
  {
    title: "Collapsed projects",
    caption: "Resting state — every project folded, chevrons only on hover, no pinned strip.",
    props: { projects: COLLAPSED_PROJECTS, pinnedSessions: [] },
  },
  {
    title: "Missing projects",
    caption: "Folders that moved on disk degrade gracefully: FolderX, strikethrough, dimmed, no actions.",
    props: { projects: MISSING_PROJECTS, pinnedSessions: [], apps: [] },
  },
  {
    title: "Empty state",
    caption: "No projects yet — the sidebar shows its centered empty placeholder.",
    props: { projects: [], pinnedSessions: [] },
  },
  {
    title: "Files tab",
    caption: "The Files tab swaps the project list for the file tree, reusing the same shell chrome.",
    props: {
      sidebarTab: "files",
      fileTree: (
        <FileTreeMock
          rootName="super-one"
          nodes={SAMPLE_FILE_TREE}
          selectedPath="packages/desktop-mocks/src/desktop/desktop-shell.tsx"
        />
      ),
    },
  },
  {
    title: "Remote offline",
    caption: "When no device is reachable, the remote indicator in the footer turns red.",
    props: { remoteOnline: false },
  },
]

const STAGE_SECONDS = 3.6
export const SIDEBAR_GALLERY_DURATION_IN_FRAMES =
  STAGES.length * STAGE_SECONDS * SIDEBAR_GALLERY_FPS

export const SidebarGalleryScene = ({ brandHue, darkMode }: SidebarGallerySceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const idx = Math.min(STAGES.length - 1, Math.floor(t / STAGE_SECONDS))
  const stage = STAGES[idx]

  const localT = t - idx * STAGE_SECONDS
  const panelOpacity = interpolate(
    localT,
    [0, 0.3, STAGE_SECONDS - 0.3, STAGE_SECONDS],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )
  const panelShift = interpolate(localT, [0, 0.4], [16, 0], {
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
            <span className="text-[11px] text-muted-foreground">Sidebar</span>
            <div className="ml-auto rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-foreground">
              {stage.title}
            </div>
          </div>

          <AbsoluteFill className="top-11 flex items-center justify-center">
            <div
              style={{
                opacity: panelOpacity,
                transform: `translateY(${panelShift}px)`,
                height: 640,
              }}
              className="flex overflow-hidden rounded-xl border border-border/60 shadow-xl"
            >
              <DesktopSidebar showTrafficLights={false} {...stage.props} />
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
