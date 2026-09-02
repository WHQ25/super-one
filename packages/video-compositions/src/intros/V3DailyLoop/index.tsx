import { AbsoluteFill, Sequence, useCurrentFrame, interpolate } from "remotion"
import {
  BrandScope,
  ChatBody,
  ChatMock,
  HARNESS_CLAUDE_HUE,
  HARNESS_CODEX_HUE,
  NewSessionMock,
  PermissionPromptMock,
  type Harness,
  type MockApp,
  type MockMessage,
} from "@superone/desktop-mocks"
import { MiniAppFullscreenShell } from "../../MiniAppFullscreenScene/index"
import {
  AppStage,
  Caption,
  EASE_OUT,
  FEATURE_WIDTH,
  ShortcutHint,
  SuperOneMark,
  Wordmark,
  fadeWindow,
  sec,
} from "../../feature-kit/index"
import { MarkdownGalleryScene } from "../../MarkdownGalleryScene/index"
import { PrivacyChips } from "../shared/privacy-chips"

export const INTRO_V3_FPS = 30
export const INTRO_V3_WIDTH = 1920
export const INTRO_V3_HEIGHT = 1080

const COLD = sec(6)
const T0830 = sec(14)
const T1100 = sec(18)
const T1430 = sec(20)
const T1800 = sec(26)
const OUTRO = sec(6)

export const INTRO_V3_DURATION_IN_FRAMES =
  COLD + T0830 + T1100 + T1430 + T1800 + OUTRO

// ── shared chat data ────────────────────────────────────────────────────────

const KANBAN_COLS = [
  {
    title: "Todo",
    tint: "oklch(0.62 0.04 60)",
    cards: ["Audit relay reconnect", "Draft 0.38 changelog"],
  },
  {
    title: "Doing",
    tint: "oklch(0.66 0.15 42)",
    cards: ["Refactor permission lifecycle", "Wire /healthz endpoint"],
  },
  {
    title: "Done",
    tint: "oklch(0.62 0.13 152)",
    cards: ["Token-stream the mocks", "Ship worktree popover"],
  },
] as const

function KanbanBody() {
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        padding: 22,
        height: "100%",
        background: "oklch(0.975 0.01 75)",
      }}
    >
      {KANBAN_COLS.map((col) => (
        <div
          key={col.title}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: "oklch(0.955 0.012 75)",
            borderRadius: 14,
            padding: 12,
            border: "1px solid oklch(0.9 0.014 70)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px 6px" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: col.tint }} />
            <span style={{ fontSize: 14, fontWeight: 650, color: "oklch(0.32 0.03 60)" }}>
              {col.title}
            </span>
            <span style={{ fontSize: 12, color: "oklch(0.6 0.02 60)" }}>{col.cards.length}</span>
          </div>
          {col.cards.map((card) => (
            <div
              key={card}
              style={{
                background: "#fff",
                borderRadius: 10,
                padding: "11px 12px",
                fontSize: 13,
                fontWeight: 500,
                color: "oklch(0.34 0.025 60)",
                boxShadow: "0 1px 3px rgba(40,30,10,0.08)",
                borderLeft: `3px solid ${col.tint}`,
              }}
            >
              {card}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

const BUILD_CHAT: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Build me a sprint board mini-app — three columns, reads my todos.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: "Scaffolding a sandboxed mini-app and wiring it to the todo bridge.",
      },
      {
        type: "tool",
        cost: 110,
        expanded: true,
        spec: {
          variant: "bash",
          command: "superone miniapp register ./apps/sprint-board",
          output:
            "✓ manifest validated (appId: sprint-board)\n✓ packed 14.2 KB\n✓ installed → Apps drawer slot 1",
        },
      },
    ],
  },
]

const APPS_WITH_NEW: MockApp[] = [
  { id: "sprint-board", name: "Sprint Board", description: "Kanban over your todos" },
  { id: "design-canvas", name: "Design Canvas", description: "Sketch UI with the agent" },
  { id: "db-explorer", name: "DB Explorer", description: "Browse the session DB" },
]

const REMOTE_SESSION: MockMessage[] = [
  { id: "u1", role: "user", text: "Bump the relay worker to 0.4 and redeploy." },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: "Bumping `wrangler.toml` to 0.4 and running the deploy. I'll need approval to publish.",
      },
      {
        type: "tool",
        cost: 90,
        expanded: true,
        spec: {
          variant: "edit",
          filePath: "apps/relay/wrangler.toml",
          startLine: 3,
          oldText: 'version = "0.3.9"',
          newText: 'version = "0.4.0"',
        },
      },
    ],
  },
]

// ── Time-of-day backdrop ────────────────────────────────────────────────────

function TimeBackdrop({
  hue,
  light = 0.97,
  chroma = 0.024,
}: {
  hue: number
  light?: number
  chroma?: number
}) {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, oklch(${light + 0.005} ${chroma * 0.5} ${hue}), oklch(${light - 0.05} ${chroma} ${hue}))`,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          right: -340,
          top: -240,
          width: 1100,
          height: 1100,
          borderRadius: "50%",
          background: `radial-gradient(circle, oklch(0.78 ${chroma * 5} ${hue} / 0.30), transparent 65%)`,
        }}
      />
    </AbsoluteFill>
  )
}

function TimeStamp({
  time,
  label,
  enter,
  exit,
  hue,
}: {
  time: string
  label: string
  enter: number
  exit: number
  hue: number
}) {
  const frame = useCurrentFrame()
  const op = fadeWindow(frame, enter, exit, sec(0.4))
  if (op <= 0.001) return null
  const rise = interpolate(frame, [enter, enter + sec(0.45)], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 78 + rise,
        width: FEATURE_WIDTH,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        opacity: op,
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 3.4,
          color: `oklch(0.56 0.16 ${hue})`,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 80,
          fontWeight: 800,
          letterSpacing: -2,
          color: "oklch(0.22 0.04 60)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {time}
      </span>
    </div>
  )
}

// ── Cold open ───────────────────────────────────────────────────────────────

function ColdOpen() {
  const frame = useCurrentFrame()
  const op = fadeWindow(frame, 0, sec(6), sec(0.5))
  const intro = interpolate(frame, [0, sec(0.8)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  return (
    <AbsoluteFill style={{ opacity: op }}>
      <TimeBackdrop hue={42} />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 22,
            opacity: intro,
            transform: `translateY(${(1 - intro) * 18}px)`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <SuperOneMark size={56} hue={42} />
            <Wordmark size={30} hue={42} />
          </div>
          <span
            style={{
              fontSize: 84,
              fontWeight: 800,
              letterSpacing: -2.2,
              lineHeight: 1.04,
              textAlign: "center",
              color: "oklch(0.24 0.04 60)",
            }}
          >
            A day with Super One.
          </span>
          <span
            style={{
              fontSize: 26,
              fontWeight: 500,
              color: "oklch(0.48 0.04 60)",
              maxWidth: 920,
              textAlign: "center",
            }}
          >
            Four moments. Two agents. One canvas that follows you.
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ── 08:30 — Multi-harness (morning, warm) ───────────────────────────────────

function Beat0830() {
  const frame = useCurrentFrame()
  const switchAt = sec(6.0)
  const harness: Harness = frame >= switchAt ? "codex" : "claude"
  const hue = harness === "codex" ? HARNESS_CODEX_HUE : HARNESS_CLAUDE_HUE
  return (
    <AbsoluteFill>
      <TimeBackdrop hue={42} />
      <AppStage
        hue={hue}
        bgChroma={0.04}
        windowW={1440}
        windowH={900}
        top={210}
        zoom={[
          { frame: 0, scale: 1.0, x: 0.5, y: 0.5 },
          { frame: sec(13), scale: 1.04, x: 0.45, y: 0.45 },
        ]}
      >
        <BrandScope brandHue={hue}>
          <NewSessionMock
            harness={harness}
            frame={frame}
            selectedProject="super-one"
            appsExpanded={false}
          />
        </BrandScope>
      </AppStage>
      <TimeStamp
        time="08:30"
        label="MORNING  ·  PICK YOUR MIND"
        enter={sec(0.4)}
        exit={sec(13.4)}
        hue={42}
      />
      <ShortcutHint
        keys={["Tab"]}
        label="Switch harness"
        x={FEATURE_WIDTH / 2}
        y={1010}
        enter={sec(4.6)}
        exit={sec(7.6)}
        pressAt={sec(5.7)}
      />
      <Caption
        text="Morning. Open a fresh session — Claude or Codex, your choice. The whole canvas takes on your harness's hue."
        kicker="ONE WORKSPACE · EITHER MIND"
        enter={sec(0.6)}
        exit={sec(13.0)}
        y={920}
      />
    </AbsoluteFill>
  )
}

// ── 11:00 — Markdown rendering (midday, citrine) ────────────────────────────

function Beat1100() {
  const frame = useCurrentFrame()
  const pan = interpolate(frame, [0, sec(18)], [-20, -420], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const scale = interpolate(frame, [0, sec(18)], [1.05, 1.12], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <AbsoluteFill>
      <TimeBackdrop hue={80} chroma={0.028} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateY(${pan}px) scale(${scale})`,
          transformOrigin: "50% 32%",
        }}
      >
        <MarkdownGalleryScene harness="claude" brandHue={80} darkMode={false} />
      </div>
      <TimeStamp
        time="11:00"
        label="MIDDAY  ·  READ THE ANSWER"
        enter={sec(0.4)}
        exit={sec(17.4)}
        hue={80}
      />
      <Caption
        text="Tables, diffs, Mermaid, math — the agent doesn't dump text, it hands you a document."
        kicker="LIVE MARKDOWN"
        enter={sec(0.6)}
        exit={sec(17.0)}
      />
    </AbsoluteFill>
  )
}

// ── 14:30 — Mini-apps (afternoon, golden) ───────────────────────────────────

function Beat1430() {
  const frame = useCurrentFrame()
  const showDrawer = frame >= sec(7.5)
  const showFullscreen = frame >= sec(13.5)
  const hue = 30
  return (
    <AbsoluteFill>
      <TimeBackdrop hue={hue} chroma={0.034} />
      {!showFullscreen ? (
        <AppStage
          hue={hue}
          bgChroma={0.05}
          windowW={1440}
          windowH={900}
          top={210}
          zoom={
            showDrawer
              ? [
                  { frame: 0, scale: 1.0, x: 0.5, y: 0.5 },
                  { frame: sec(0.6), scale: 1.16, x: 0.12, y: 0.26 },
                ]
              : undefined
          }
        >
          <BrandScope brandHue={hue}>
            <ChatMock
              title="Build a sprint board mini-app"
              harness="claude"
              messages={BUILD_CHAT}
              frame={frame}
              fps={INTRO_V3_FPS}
              typingCps={140}
              userPauseMs={350}
              assistantPauseMs={300}
              appsExpanded={showDrawer}
              apps={showDrawer ? APPS_WITH_NEW : undefined}
              showFooter={!showDrawer}
            />
          </BrandScope>
        </AppStage>
      ) : (
        <AppStage
          hue={hue}
          bgChroma={0.05}
          windowW={1440}
          windowH={900}
          top={210}
        >
          <BrandScope brandHue={hue}>
            <MiniAppFullscreenShell appName="Sprint Board" appVersion="v1.0.0">
              <KanbanBody />
            </MiniAppFullscreenShell>
          </BrandScope>
        </AppStage>
      )}
      {showDrawer && !showFullscreen ? (
        <ShortcutHint
          keys={["1"]}
          label="Open mini-app"
          x={FEATURE_WIDTH / 2}
          y={1010}
          enter={sec(8.0)}
          exit={sec(13.5)}
          pressAt={sec(12.8)}
        />
      ) : null}
      <TimeStamp
        time="14:30"
        label="AFTERNOON  ·  ASK FOR A TOOL"
        enter={sec(0.4)}
        exit={sec(19.4)}
        hue={hue}
      />
      <Caption
        text="Need a tool? Don't search the app store. Ask your agent to scaffold one — sandboxed, installed, ready."
        kicker="AGENT-BUILT MINI-APPS"
        enter={sec(0.6)}
        exit={sec(19.0)}
        y={920}
      />
    </AbsoluteFill>
  )
}

// ── 18:00 — Remote + privacy (evening, twilight blue) ───────────────────────

function PhoneFrame({
  children,
  width = 392,
}: {
  children: React.ReactNode
  width?: number
}) {
  const height = width * 2.05
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 52,
        background: "linear-gradient(160deg, #2a2622, #14110e)",
        padding: 13,
        boxShadow: "0 44px 90px -24px rgba(20,18,40,0.6)",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 40,
          overflow: "hidden",
          position: "relative",
          background: "#fff",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            width: 116,
            height: 30,
            borderRadius: 16,
            background: "#14110e",
            zIndex: 20,
          }}
        />
        {children}
      </div>
    </div>
  )
}

function Beat1800() {
  const frame = useCurrentFrame()
  const showPhone = frame >= sec(2.0)
  const showPermission = frame >= sec(10.0)
  const showChips = frame >= sec(17.0)
  const phoneSlide = interpolate(frame, [sec(2.0), sec(3.0)], [120, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  const phoneOp = interpolate(frame, [sec(2.0), sec(3.0)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const desktopShift = interpolate(frame, [sec(2.0), sec(3.0)], [0, -240], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  return (
    <AbsoluteFill>
      <TimeBackdrop hue={240} light={0.93} chroma={0.04} />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 220,
          transform: `translateX(calc(-50% + ${desktopShift}px))`,
          width: 1200,
          height: 752,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 50px 110px -30px rgba(20,18,40,0.6), 0 0 0 1px rgba(0,0,0,0.05)",
            opacity: showChips ? 0.55 : 1,
            transition: "opacity 0.4s",
          }}
        >
          <div
            style={{
              width: 1280,
              height: 800,
              transform: `scale(${1200 / 1280})`,
              transformOrigin: "top left",
            }}
          >
            <BrandScope brandHue={HARNESS_CLAUDE_HUE}>
              <ChatMock
                title="Bump relay worker to 0.4"
                harness="claude"
                messages={REMOTE_SESSION}
                frame={frame}
                fps={INTRO_V3_FPS}
                typingCps={80}
                userPauseMs={350}
                assistantPauseMs={300}
                showFooter={false}
              />
            </BrandScope>
          </div>
        </div>
      </div>
      {showPhone ? (
        <div
          style={{
            position: "absolute",
            right: 200,
            top: 170,
            opacity: phoneOp,
            transform: `translateY(${phoneSlide}px)`,
          }}
        >
          <PhoneFrame width={392}>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 48,
                bottom: 0,
                background: "var(--card, #fff)",
              }}
            >
              <BrandScope brandHue={HARNESS_CLAUDE_HUE}>
                <ChatBody
                  messages={REMOTE_SESSION}
                  frame={frame}
                  fps={INTRO_V3_FPS}
                  typingCps={80}
                  userPauseMs={350}
                  assistantPauseMs={300}
                  harness="claude"
                  showFooter={false}
                  permissionPrompt={
                    showPermission ? (
                      <PermissionPromptMock
                        spec={{ variant: "bash", command: "wrangler deploy" }}
                        description="publish relay worker 0.4"
                        focusedAction="allow"
                      />
                    ) : undefined
                  }
                />
              </BrandScope>
            </div>
          </PhoneFrame>
        </div>
      ) : null}
      {showChips ? (
        <PrivacyChips enter={sec(17.0)} x={520} y={620} variant="light" hue={152} />
      ) : null}
      <TimeStamp
        time="18:00"
        label="EVENING  ·  LEAVE THE DESK"
        enter={sec(0.4)}
        exit={sec(25.4)}
        hue={240}
      />
      <Caption
        text={
          frame < sec(16)
            ? "Leave the desk. Pair your phone — the session keeps streaming, you keep approving."
            : "Privacy first: no data stored on our relay. End-to-end encrypted — files included."
        }
        kicker={frame < sec(16) ? "REMOTE CONTROL" : "PRIVACY FIRST"}
        enter={sec(0.6)}
        exit={sec(25.0)}
      />
    </AbsoluteFill>
  )
}

// ── Outro ────────────────────────────────────────────────────────────────────

function DailyLoopOutro() {
  const frame = useCurrentFrame()
  const inP = interpolate(frame, [0, sec(0.8)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  const exit = interpolate(frame, [sec(5), sec(6)], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const op = Math.min(inP, exit)
  return (
    <AbsoluteFill>
      <TimeBackdrop hue={240} light={0.93} chroma={0.04} />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          opacity: op,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 22,
            transform: `translateY(${(1 - inP) * 18}px)`,
          }}
        >
          <SuperOneMark size={92} hue={240} />
          <Wordmark size={54} hue={240} />
          <span
            style={{
              fontSize: 24,
              fontWeight: 500,
              color: "oklch(0.46 0.04 60)",
              letterSpacing: 0.2,
              maxWidth: 760,
              textAlign: "center",
            }}
          >
            From morning coffee to last commit — your canvas, anywhere.
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ── Composition root ────────────────────────────────────────────────────────

export const introV3DailyLoopDefaultProps = {}

export function IntroV3DailyLoop() {
  let offset = 0
  const beats: { len: number; el: React.ReactNode }[] = [
    { len: COLD, el: <ColdOpen /> },
    { len: T0830, el: <Beat0830 /> },
    { len: T1100, el: <Beat1100 /> },
    { len: T1430, el: <Beat1430 /> },
    { len: T1800, el: <Beat1800 /> },
    { len: OUTRO, el: <DailyLoopOutro /> },
  ]
  return (
    <BrandScope brandHue={42}>
      <AbsoluteFill style={{ background: "oklch(0.975 0.012 78)" }}>
        {beats.map((b, i) => {
          const from = offset
          offset += b.len
          return (
            <Sequence key={i} from={from} durationInFrames={b.len}>
              {b.el}
            </Sequence>
          )
        })}
      </AbsoluteFill>
    </BrandScope>
  )
}
