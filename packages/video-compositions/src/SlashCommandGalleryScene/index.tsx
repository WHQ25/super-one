import { useMemo, type ReactNode } from "react"
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import {
  AddDirSlashPopupMock,
  BrandScope,
  ChatMock,
  HARNESS_CLAUDE_HUE,
  McpSlashPopupMock,
  ProviderSlashPopupMock,
  type Harness,
  type MockMessage,
} from "@superone/desktop-mocks"

export const SLASH_COMMAND_GALLERY_FPS = 30
export const SLASH_COMMAND_GALLERY_WIDTH = 1280
export const SLASH_COMMAND_GALLERY_HEIGHT = 800

export type SlashCommandGallerySceneProps = {
  harness: Harness
  brandHue: number
  darkMode: boolean
}

interface Stage {
  title: string
  caption: string
  placeholder: string
  popover: ReactNode
}

const STAGES: Stage[] = [
  {
    title: "/add-dir · overview",
    caption: "Pinned directories in this project — User / Project / Session scopes",
    placeholder: "/add-dir",
    popover: <AddDirSlashPopupMock variant="overview" />,
  },
  {
    title: "/add-dir · path completion",
    caption: "Fuzzy-match subdirectories under the current project root",
    placeholder: "/add-dir session a",
    popover: (
      <AddDirSlashPopupMock
        variant="path"
        absolutePath="/Users/hangqi/Developer/Projects/super-one/"
        pathCandidates={[
          { name: "apps", matchIndices: [0], focused: true },
          { name: "packages", matchIndices: [] },
          { name: "scripts", matchIndices: [] },
          { name: "patches", matchIndices: [] },
        ]}
      />
    ),
  },
  {
    title: "/mcp · live servers",
    caption: "Status dots + per-server tool count, expand to peek tools",
    placeholder: "/mcp",
    popover: <McpSlashPopupMock variant="live" />,
  },
  {
    title: "/mcp · empty state",
    caption: "No MCP servers yet — link to Settings → MCP",
    placeholder: "/mcp",
    popover: <McpSlashPopupMock variant="empty" />,
  },
  {
    title: "/provider · switch API gateway",
    caption: "Branded picker — default Claude, plus configured providers",
    placeholder: "/provider",
    popover: (
      <ProviderSlashPopupMock
        items={[
          { id: "default", brand: "claude", label: "Claude (Default)", current: true },
          { id: "openrouter", brand: "openrouter", label: "OpenRouter", focused: true },
          { id: "zhipu", brand: "zhipu", label: "Z.ai GLM" },
          { id: "deepseek", brand: "deepseek", label: "DeepSeek" },
          { id: "volcengine", brand: "volcengine", label: "Volcengine" },
        ]}
      />
    ),
  },
  {
    title: "/provider · while streaming",
    caption: "Streaming guard — switch applied after current turn finishes",
    placeholder: "/provider",
    popover: (
      <ProviderSlashPopupMock
        streaming
        items={[
          { id: "default", brand: "claude", label: "Claude (Default)", current: true },
          { id: "zhipu", brand: "zhipu", label: "Z.ai GLM", focused: true },
          { id: "kimi", brand: "kimi", label: "Kimi" },
        ]}
      />
    ),
  },
]

const STAGE_SECONDS = 3.5
export const SLASH_COMMAND_GALLERY_DURATION_IN_FRAMES =
  STAGES.length * STAGE_SECONDS * SLASH_COMMAND_GALLERY_FPS

export const slashCommandGallerySceneDefaultProps: SlashCommandGallerySceneProps = {
  harness: "claude",
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: true,
}

const BASE_MESSAGES: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text:
      "Show me how slash commands feel in SuperOne — /add-dir for pinning directories and /mcp for live MCP servers.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text:
          "Sure — typing `/` pops a panel above the input. Use **/add-dir** to pin folders into the session or project, and **/mcp** to inspect connected servers without leaving chat.",
      },
    ],
  },
]

export const SlashCommandGalleryScene = ({
  harness,
  brandHue,
  darkMode,
}: SlashCommandGallerySceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const idx = Math.min(STAGES.length - 1, Math.floor(t / STAGE_SECONDS))
  const stage = STAGES[idx]

  const localT = t - idx * STAGE_SECONDS
  const popoverOpacity = interpolate(
    localT,
    [0, 0.3, STAGE_SECONDS - 0.3, STAGE_SECONDS],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )
  const popoverYOffset = interpolate(localT, [0, 0.4], [12, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const shellOpacity = interpolate(frame, [0, 0.4 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const messages = useMemo(() => BASE_MESSAGES, [])

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="items-center justify-center bg-muted p-6">
        <div
          style={{ width: 1232, height: 752, opacity: shellOpacity }}
          className="relative overflow-hidden rounded-2xl shadow-2xl ring-1 ring-border/60"
        >
          <ChatMock
            title={stage.title}
            harness={harness}
            messages={messages}
            placeholder={stage.placeholder}
            showTrafficLights
          />

          <div
            className="pointer-events-none absolute inset-x-0 bottom-[124px] z-20 mx-auto flex w-full max-w-3xl justify-center px-3"
            style={{
              opacity: popoverOpacity,
              transform: `translateY(${popoverYOffset}px)`,
            }}
          >
            <div className="w-full">{stage.popover}</div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 mx-auto flex max-w-3xl justify-center">
            <div className="rounded-full bg-background/80 px-3 py-1 text-[11px] text-muted-foreground shadow-sm ring-1 ring-border/60 backdrop-blur">
              {stage.caption}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}
