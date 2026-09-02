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
  EASE_OUT,
  FEATURE_HEIGHT,
  FEATURE_WIDTH,
  ShortcutHint,
  Wordmark,
  SuperOneMark,
  fadeWindow,
  mapX,
  mapY,
  makeStage,
  sec,
} from "../../feature-kit/index"
import { MarkdownGalleryScene } from "../../MarkdownGalleryScene/index"
import { ChapterBanner } from "../shared/chapter-banner"
import { PrivacyChips } from "../shared/privacy-chips"

export const INTRO_V1_FPS = 30
export const INTRO_V1_WIDTH = 1920
export const INTRO_V1_HEIGHT = 1080

const COLD = sec(3)
const CH1 = sec(9)
const CH2 = sec(9)
const CH3 = sec(9)
const CH4 = sec(10)
const OUTRO = sec(5)

export const INTRO_V1_DURATION_IN_FRAMES = COLD + CH1 + CH2 + CH3 + CH4 + OUTRO

const STAGE = makeStage()

const MARKDOWN_HUE = 280
const MINIAPP_HUE = 152
const REMOTE_HUE = 240

// ── shared chat fragments ───────────────────────────────────────────────────

const KANBAN_COLS: { title: string; tint: string; cards: string[] }[] = [
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
    cards: ["Token-stream the mocks", "Ship worktree popover", "Fix mDNS EPERM"],
  },
]

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

// ── shared dark backdrop ────────────────────────────────────────────────────

function DarkBackdrop({ hue = 240 }: { hue?: number }) {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 90% at 50% 0%, oklch(0.22 0.05 ${hue}) 0%, oklch(0.11 0.02 ${hue}) 60%, #07060c 100%)`,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage:
            "radial-gradient(ellipse 75% 60% at 50% 50%, black 35%, transparent 90%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 75% 60% at 50% 50%, black 35%, transparent 90%)",
        }}
      />
    </AbsoluteFill>
  )
}

// ── Cold open ───────────────────────────────────────────────────────────────

function ColdOpen() {
  const frame = useCurrentFrame()
  const enter = interpolate(frame, [0, sec(0.5)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  const exit = interpolate(frame, [sec(2.4), sec(3.0)], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const op = Math.min(enter, exit)
  const scale = interpolate(enter, [0, 1], [0.9, 1])
  const slide = interpolate(enter, [0, 1], [22, 0])
  return (
    <AbsoluteFill>
      <DarkBackdrop hue={250} />
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
            gap: 28,
            transform: `translateY(${slide}px) scale(${scale})`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <SuperOneMark size={68} hue={250} />
            <Wordmark size={36} hue={250} />
          </div>
          <span
            style={{
              fontSize: 96,
              fontWeight: 800,
              letterSpacing: -2.4,
              color: "#fbf6ee",
              textShadow: "0 24px 60px rgba(0,0,0,0.55)",
            }}
          >
            ONE CANVAS.
          </span>
          <span
            style={{
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: 4,
              color: "oklch(0.74 0.10 250)",
            }}
          >
            EVERY AGENT — EVERY DEVICE
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ── Chapter 1 — Pick your mind (multi-harness) ──────────────────────────────

function Chapter1() {
  const frame = useCurrentFrame()
  const switchAt = sec(3.6)
  const harness: Harness = frame >= switchAt ? "codex" : "claude"
  const hue = harness === "codex" ? HARNESS_CODEX_HUE : HARNESS_CLAUDE_HUE
  const codexX = mapX(STAGE, 859)
  const codexY = mapY(STAGE, 381)
  return (
    <AbsoluteFill>
      <DarkBackdrop hue={hue} />
      <AppStage
        hue={hue}
        bgChroma={0.05}
        windowW={1280}
        windowH={800}
        top={210}
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
      <ShortcutHint
        keys={["⌘", "N"]}
        label="New session"
        x={FEATURE_WIDTH / 2}
        y={170}
        enter={sec(0.4)}
        exit={sec(3.4)}
        pressAt={sec(0.9)}
      />
      <ShortcutHint
        keys={["Tab"]}
        label="Switch harness"
        x={FEATURE_WIDTH / 2}
        y={170}
        enter={sec(3.0)}
        exit={sec(5.4)}
        pressAt={sec(3.4)}
      />
      <ChapterBanner
        index={1}
        title="PICK YOUR MIND."
        enter={sec(0.4)}
        exit={sec(8.6)}
        hue={hue}
      />
    </AbsoluteFill>
  )
}

// ── Chapter 2 — Rendered like print (markdown) ──────────────────────────────

function Chapter2() {
  const frame = useCurrentFrame()
  // Pan the gallery slightly to suggest movement through the document.
  const pan = interpolate(frame, [0, sec(9)], [-30, -260], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const scale = interpolate(frame, [0, sec(9)], [1.02, 1.1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <AbsoluteFill>
      <DarkBackdrop hue={MARKDOWN_HUE} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateY(${pan}px) scale(${scale})`,
          transformOrigin: "50% 30%",
        }}
      >
        <MarkdownGalleryScene
          harness="claude"
          brandHue={MARKDOWN_HUE}
          darkMode
        />
      </div>
      <ChapterBanner
        index={2}
        title="RENDERED LIKE PRINT."
        enter={sec(0.4)}
        exit={sec(8.6)}
        hue={MARKDOWN_HUE}
      />
    </AbsoluteFill>
  )
}

// ── Chapter 3 — Your agent builds the app ───────────────────────────────────

function Chapter3() {
  const frame = useCurrentFrame()
  const showDrawer = frame >= sec(3.0)
  const showFullscreen = frame >= sec(6.0)
  return (
    <AbsoluteFill>
      <DarkBackdrop hue={MINIAPP_HUE} />
      {!showFullscreen ? (
        <AppStage
          hue={MINIAPP_HUE}
          bgChroma={0.05}
          windowW={1280}
          windowH={800}
          top={210}
          zoom={
            showDrawer
              ? [
                  { frame: 0, scale: 1.0, x: 0.5, y: 0.5 },
                  { frame: sec(0.6), scale: 1.18, x: 0.12, y: 0.26 },
                ]
              : undefined
          }
        >
          <BrandScope brandHue={MINIAPP_HUE}>
            <ChatMock
              title="Build a sprint board mini-app"
              harness="claude"
              messages={BUILD_CHAT}
              frame={frame}
              fps={INTRO_V1_FPS}
              typingCps={220}
              userPauseMs={250}
              assistantPauseMs={200}
              appsExpanded={showDrawer}
              apps={showDrawer ? APPS_WITH_NEW : undefined}
              showFooter={!showDrawer}
            />
          </BrandScope>
        </AppStage>
      ) : (
        <AppStage
          hue={MINIAPP_HUE}
          bgChroma={0.05}
          windowW={1280}
          windowH={800}
          top={210}
        >
          <BrandScope brandHue={MINIAPP_HUE}>
            <MiniAppFullscreenShell appName="Sprint Board" appVersion="v1.0.0">
              <KanbanBody />
            </MiniAppFullscreenShell>
          </BrandScope>
        </AppStage>
      )}
      {showDrawer && !showFullscreen ? (
        <ShortcutHint
          keys={["1"]}
          label="Open"
          x={FEATURE_WIDTH / 2}
          y={170}
          enter={sec(3.4)}
          exit={sec(6.2)}
          pressAt={sec(5.7)}
        />
      ) : null}
      <ChapterBanner
        index={3}
        title="YOUR AGENT BUILDS THE APP."
        enter={sec(0.4)}
        exit={sec(8.6)}
        hue={MINIAPP_HUE}
      />
    </AbsoluteFill>
  )
}

// ── Chapter 4 — Privacy first remote control ────────────────────────────────

function PhoneFrame({
  children,
  width = 380,
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
        borderRadius: 50,
        background: "linear-gradient(160deg, #2a2622, #14110e)",
        padding: 12,
        boxShadow: "0 44px 90px -24px rgba(0,0,0,0.7)",
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
            width: 110,
            height: 28,
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

function Chapter4() {
  const frame = useCurrentFrame()
  const showPhone = frame >= sec(1.6)
  const showPermission = frame >= sec(4.6)
  const showChips = frame >= sec(6.4)

  const phoneSlide = interpolate(frame, [sec(1.6), sec(2.4)], [120, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  const phoneOp = interpolate(frame, [sec(1.6), sec(2.4)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const desktopShift = interpolate(frame, [sec(1.6), sec(2.4)], [0, -200], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })

  return (
    <AbsoluteFill>
      <DarkBackdrop hue={REMOTE_HUE} />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 220,
          transform: `translateX(calc(-50% + ${desktopShift}px))`,
          width: 1180,
          height: 740,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 50px 110px -30px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.05)",
            opacity: showChips ? 0.55 : 1,
            transition: "opacity 0.4s",
          }}
        >
          <div
            style={{
              width: 1280,
              height: 800,
              transform: `scale(${1180 / 1280})`,
              transformOrigin: "top left",
            }}
          >
            <BrandScope brandHue={REMOTE_HUE}>
              <ChatMock
                title="Bump relay worker to 0.4"
                harness="claude"
                messages={REMOTE_SESSION}
                frame={frame}
                fps={INTRO_V1_FPS}
                typingCps={120}
                userPauseMs={250}
                assistantPauseMs={200}
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
            right: 220,
            top: 152,
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
              <BrandScope brandHue={REMOTE_HUE}>
                <ChatBody
                  messages={REMOTE_SESSION}
                  frame={frame}
                  fps={INTRO_V1_FPS}
                  typingCps={120}
                  userPauseMs={250}
                  assistantPauseMs={200}
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
        <PrivacyChips
          enter={sec(6.4)}
          x={580}
          y={620}
          variant="dark"
          hue={152}
        />
      ) : null}

      <ChapterBanner
        index={4}
        title="PRIVACY FIRST. ANYWHERE."
        enter={sec(0.4)}
        exit={sec(9.6)}
        hue={REMOTE_HUE}
      />
    </AbsoluteFill>
  )
}

// ── Outro — 2×2 grid + logo ─────────────────────────────────────────────────

function QuadrantOutro() {
  const frame = useCurrentFrame()
  const settle = interpolate(frame, [0, sec(0.8)], [0.85, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  const opEnter = interpolate(frame, [0, sec(0.7)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const exit = interpolate(frame, [sec(4.3), sec(5)], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const op = Math.min(opEnter, exit)

  const tiles = [
    { hue: HARNESS_CLAUDE_HUE, label: "HARNESS" },
    { hue: MARKDOWN_HUE, label: "MARKDOWN" },
    { hue: MINIAPP_HUE, label: "MINI-APPS" },
    { hue: REMOTE_HUE, label: "REMOTE · E2E" },
  ]

  return (
    <AbsoluteFill>
      <DarkBackdrop hue={250} />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          opacity: op,
        }}
      >
        <div
          style={{
            position: "relative",
            width: 1080,
            height: 600,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "1fr 1fr",
            gap: 18,
            transform: `scale(${settle})`,
          }}
        >
          {tiles.map((t) => (
            <div
              key={t.label}
              style={{
                position: "relative",
                borderRadius: 22,
                background: `linear-gradient(135deg, oklch(0.62 0.16 ${t.hue}), oklch(0.38 0.12 ${t.hue}))`,
                boxShadow: "0 30px 60px -20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.18)",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: 28,
                  bottom: 22,
                  color: "#fff",
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 2.4,
                  opacity: 0.92,
                }}
              >
                {t.label}
              </span>
            </div>
          ))}

          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              padding: "26px 36px",
              borderRadius: 26,
              background: "rgba(8,6,12,0.86)",
              border: "1px solid rgba(255,255,255,0.10)",
              boxShadow: "0 30px 70px -16px rgba(0,0,0,0.65)",
            }}
          >
            <SuperOneMark size={64} hue={250} />
            <Wordmark size={32} hue={250} />
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: 3,
                color: "oklch(0.74 0.10 250)",
              }}
            >
              SUPER ONE
            </span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ── Composition root ────────────────────────────────────────────────────────

export const introV1QuadrantDefaultProps = {}

export function IntroV1Quadrant() {
  let offset = 0
  const beats: { len: number; el: React.ReactNode }[] = [
    { len: COLD, el: <ColdOpen /> },
    { len: CH1, el: <Chapter1 /> },
    { len: CH2, el: <Chapter2 /> },
    { len: CH3, el: <Chapter3 /> },
    { len: CH4, el: <Chapter4 /> },
    { len: OUTRO, el: <QuadrantOutro /> },
  ]
  return (
    <BrandScope brandHue={250}>
      <AbsoluteFill style={{ background: "#07060c" }}>
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
