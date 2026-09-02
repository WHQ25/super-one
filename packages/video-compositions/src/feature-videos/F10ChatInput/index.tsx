// Feature 10 — Smart Chat Input: commands, mentions, skills and files in one box.

import { AbsoluteFill, useCurrentFrame } from "remotion"
import {
  ChatInputAdvancedMock,
  DesktopShell,
  HARNESS_CLAUDE_HUE,
  type MentionChipMock,
  type SlashCommandSuggestionMock,
  type MentionPopupItemMock,
} from "@superone/desktop-mocks"
import {
  AppStage,
  Caption,
  FeatureVideo,
  ShortcutHint,
  featureVideoDuration,
  sec,
  type FeatureBeat,
} from "../../feature-kit/index"

export const CHAT_INPUT_FPS = 30
export const CHAT_INPUT_WIDTH = 1920
export const CHAT_INPUT_HEIGHT = 1080

const SLASH_COMMANDS: SlashCommandSuggestionMock[] = [
  { name: "review", description: "Review the current diff for correctness bugs", argumentHint: "[effort]" },
  { name: "plan", description: "Enter plan mode and start", argumentHint: "[description]" },
  { name: "test", description: "Run the project test suite", isSkill: true },
  { name: "worktree", description: "Create an isolated git worktree", isSkill: true },
  { name: "commit", description: "Stage, commit and push the current change" },
]

const MENTION_ITEMS: MentionPopupItemMock[] = [
  { kind: "file", name: "relay/src/session.ts", subtitle: "apps/relay/src" },
  { kind: "file", name: "relay/src/router.ts", subtitle: "apps/relay/src" },
  { kind: "directory", name: "relay/", subtitle: "apps" },
  { kind: "agent", name: "code-reviewer", subtitle: "subagent" },
]

const MENTION_CHIPS: MentionChipMock[] = [
  { kind: "file", displayName: "session.ts" },
  { kind: "directory", displayName: "relay/" },
]

// ── App frame: a fresh session with the advanced input ──────────────────────
function InputApp({
  value,
  slashOpen,
  mentionOpen,
  mentions,
  pasteOpen,
  attachOpen,
  caretOn,
}: {
  value: string
  slashOpen?: boolean
  mentionOpen?: boolean
  mentions?: MentionChipMock[]
  pasteOpen?: boolean
  attachOpen?: boolean
  caretOn: boolean
}): React.ReactNode {
  return (
    <DesktopShell headerTitle="New session — super-one" showTrafficLights>
      <div className="flex h-full flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 16,
              background: "linear-gradient(155deg, oklch(0.76 0.15 42), oklch(0.6 0.18 42))",
            }}
          />
          <span className="text-sm text-muted-foreground">
            One box for prompts, commands, skills, files and images.
          </span>
        </div>
        <div className="mx-auto w-full max-w-3xl">
          <ChatInputAdvancedMock
            harness="claude"
            value={value}
            caretAtEnd
            caretOn={caretOn}
            mentions={mentions}
            pasteChips={
              pasteOpen
                ? [
                    {
                      preview: "export function buildTokenEndTimes(seed, lens, dur) {",
                      lineCount: 38,
                    },
                  ]
                : undefined
            }
            attachments={
              attachOpen
                ? [
                    {
                      type: "image",
                      name: "sidebar-bug.png",
                      thumbnail: { kind: "screenshot", hueA: 42, hueB: 165 },
                    },
                    { type: "pdf", name: "relay-spec.pdf", pages: 6 },
                  ]
                : undefined
            }
            slashPopup={
              slashOpen
                ? { query: value.replace(/^\//, ""), commands: SLASH_COMMANDS, activeIndex: 0 }
                : undefined
            }
            mentionPopup={
              mentionOpen
                ? {
                    query: "rel",
                    breadcrumbs: ["super-one"],
                    items: MENTION_ITEMS,
                    activeIndex: 0,
                  }
                : undefined
            }
          />
        </div>
      </div>
    </DesktopShell>
  )
}

// ── Beats ───────────────────────────────────────────────────────────────────
function BeatSlash(): React.ReactNode {
  const frame = useCurrentFrame()
  const caretOn = Math.floor((frame / CHAT_INPUT_FPS) * 2) % 2 === 0
  return (
    <AbsoluteFill>
      <AppStage
        hue={HARNESS_CLAUDE_HUE}
        zoom={[
          { frame: 0, scale: 1.08, x: 0.5, y: 0.92 },
          { frame: sec(5.4), scale: 1.16, x: 0.5, y: 0.96 },
        ]}
      >
        <InputApp value="/rev" slashOpen caretOn={caretOn} />
      </AppStage>
      <ShortcutHint
        keys={["Tab"]}
        label="Autocomplete"
        x={960}
        y={150}
        enter={sec(1.0)}
        exit={sec(5.6)}
        pressAt={sec(3.0)}
      />
      <Caption
        text="Type / for commands and skills — built-in or your own — fuzzy-matched as you go."
        kicker="SLASH COMMANDS"
        enter={sec(0.5)}
        exit={sec(5.8)}
      />
    </AbsoluteFill>
  )
}

function BeatMention(): React.ReactNode {
  const frame = useCurrentFrame()
  const caretOn = Math.floor((frame / CHAT_INPUT_FPS) * 2) % 2 === 0
  const showChips = frame >= sec(3.4)
  return (
    <AbsoluteFill>
      <AppStage
        hue={HARNESS_CLAUDE_HUE}
        zoom={[
          { frame: 0, scale: 1.1, x: 0.5, y: 0.94 },
          { frame: sec(5.8), scale: 1.16, x: 0.5, y: 0.96 },
        ]}
      >
        <InputApp
          value={showChips ? "diff " : "@rel"}
          mentionOpen={!showChips}
          mentions={showChips ? MENTION_CHIPS : undefined}
          caretOn={caretOn}
        />
      </AppStage>
      <Caption
        text="Type @ to pull in any file, directory or subagent as precise context."
        kicker="@-MENTIONS"
        enter={sec(0.5)}
        exit={sec(6.0)}
      />
    </AbsoluteFill>
  )
}

function BeatAttach(): React.ReactNode {
  const frame = useCurrentFrame()
  const caretOn = Math.floor((frame / CHAT_INPUT_FPS) * 2) % 2 === 0
  return (
    <AbsoluteFill>
      <AppStage
        hue={HARNESS_CLAUDE_HUE}
        zoom={[
          { frame: 0, scale: 1.08, x: 0.5, y: 0.9 },
          { frame: sec(5.8), scale: 1.0, x: 0.5, y: 0.7 },
        ]}
      >
        <InputApp
          value="Here's the bug and the spec — fix it."
          pasteOpen
          attachOpen
          caretOn={caretOn}
        />
      </AppStage>
      <Caption
        text="Paste code, drop images, attach PDFs — every kind of context, one box."
        kicker="ANYTHING AS CONTEXT"
        enter={sec(0.5)}
        exit={sec(6.0)}
      />
    </AbsoluteFill>
  )
}

const BEATS: FeatureBeat[] = [
  { durationInFrames: sec(6.4), content: <BeatSlash /> },
  { durationInFrames: sec(6.6), content: <BeatMention /> },
  { durationInFrames: sec(6.6), content: <BeatAttach /> },
]

export const CHAT_INPUT_DURATION_IN_FRAMES = featureVideoDuration(BEATS)
export const chatInputDefaultProps = {}

export function ChatInputVideo(): React.ReactNode {
  return (
    <FeatureVideo
      index={10}
      title={"One box.\nEvery kind of context."}
      subtitle="Slash commands, @-mentions, skills, pasted code, images and PDFs — SuperOne's chat input turns a prompt into precise, rich context."
      hue={HARNESS_CLAUDE_HUE}
      beats={BEATS}
      outroTagline="Say it, mention it, drop it in."
    />
  )
}
