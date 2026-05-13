import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion"
import {
  BrandScope,
  ChatMock,
  HARNESS_CLAUDE_HUE,
  type Harness,
  type MockMessage,
} from "@superone/desktop-mocks"

export const CHAT_STREAM_FPS = 30
export const CHAT_STREAM_WIDTH = 1280
export const CHAT_STREAM_HEIGHT = 800
export const CHAT_STREAM_DURATION_IN_FRAMES = 28 * CHAT_STREAM_FPS

export type ChatStreamProps = {
  title: string
  harness: Harness
  typingCps: number
  messages: MockMessage[]
  brandHue: number
  darkMode: boolean
}

const DEFAULT_MESSAGES: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Help me refactor the sidebar so project rows collapse independently.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: `Sure. Here's the plan I'd take, scoped to \`AppSidebar.tsx\`.

1. Replace the boolean expansion state with a \`Set<string>\` keyed by \`folderPath\`.
2. Wire the chevron's \`onClick\` to toggle that set; keep the row body click for selection.
3. Skip persistence for now — verify the in-memory behavior first.

Want me to draft the full diff against the current \`AppSidebar.tsx\`?`,
      },
    ],
  },
  {
    id: "u2",
    role: "user",
    text: "Yes please — and add Cmd+Shift+[ to collapse the active project.",
  },
  {
    id: "a2",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: `### Keyboard shortcut

I'll register a sidebar-scoped \`keydown\` listener mirroring the tab switcher pattern. It calls \`toggle(currentFolder)\` when the modifier combo fires.

\`\`\`ts
useKeyboardShortcut('mod+shift+[', () => {
  if (activeFolder) toggle(activeFolder)
})
\`\`\`

Bailing out when focus is inside an editable element so we never fight inputs.`,
      },
    ],
  },
]

export const chatStreamDefaultProps: ChatStreamProps = {
  title: "Refactor sidebar layout",
  harness: "claude",
  typingCps: 90,
  messages: DEFAULT_MESSAGES,
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

export const ChatStream = ({
  title,
  harness,
  typingCps,
  messages,
  brandHue,
  darkMode,
}: ChatStreamProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="items-center justify-center bg-muted p-6">
        <div
          style={{ width: 1232, height: 752 }}
          className="overflow-hidden rounded-2xl shadow-2xl ring-1 ring-border/60"
        >
          <ChatMock
            title={title}
            harness={harness}
            messages={messages}
            frame={frame}
            fps={fps}
            typingCps={typingCps}
            showTrafficLights
          />
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}
