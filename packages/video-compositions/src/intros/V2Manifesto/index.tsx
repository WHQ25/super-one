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
  Cursor,
  EASE_OUT,
  FEATURE_WIDTH,
  ShortcutHint,
  SuperOneMark,
  Wordmark,
  fadeWindow,
  mapX,
  mapY,
  makeStage,
  sec,
} from "../../feature-kit/index"
import { MarkdownGalleryScene } from "../../MarkdownGalleryScene/index"
import { PrivacyChips } from "../shared/privacy-chips"

export const INTRO_V2_FPS = 30
export const INTRO_V2_WIDTH = 1920
export const INTRO_V2_HEIGHT = 1080

const COLD = sec(6)
const B1 = sec(12)
const B2 = sec(15)
const B3 = sec(16)
const B4 = sec(20)
const OUTRO = sec(6)

export const INTRO_V2_DURATION_IN_FRAMES = COLD + B1 + B2 + B3 + B4 + OUTRO

const STAGE = makeStage()

// ── shared chat data (mirrors V1, retuned for slower pacing) ───────────────

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
        text: "Scaffolding a sandboxed mini-app and wiring it to the todo bridge — it'll land in your Apps drawer.",
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

// ── shared warm backdrop ────────────────────────────────────────────────────

function WarmBackdrop({ hue = 42 }: { hue?: number }) {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, oklch(0.975 0.012 ${hue}), oklch(0.94 0.024 ${hue}))`,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          right: -360,
          top: -260,
          width: 1100,
          height: 1100,
          borderRadius: "50%",
          background: `radial-gradient(circle, oklch(0.78 0.13 ${hue} / 0.32), transparent 65%)`,
        }}
      />
    </AbsoluteFill>
  )
}

// ── Cold open — manifesto title card ────────────────────────────────────────

function ColdOpen() {
  const frame = useCurrentFrame()
  const op = fadeWindow(frame, 0, sec(6), sec(0.5))
  const intro = interpolate(frame, [0, sec(1.0)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  const slide = interpolate(intro, [0, 1], [20, 0])
  const subP = interpolate(frame, [sec(0.8), sec(1.6)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  const accentP = interpolate(frame, [sec(1.4), sec(2.2)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })

  return (
    <AbsoluteFill style={{ opacity: op }}>
      <WarmBackdrop hue={42} />
      <AbsoluteFill style={{ alignItems: "flex-start", justifyContent: "center", padding: "0 150px" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 28,
            maxWidth: 1280,
            transform: `translateY(${slide}px)`,
            opacity: intro,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <SuperOneMark size={52} hue={42} />
            <Wordmark size={28} hue={42} />
            <span style={{ width: 1, height: 28, background: "oklch(0.86 0.014 70)" }} />
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: 2.6,
                color: "oklch(0.58 0.14 42)",
              }}
            >
              INTRODUCING SUPER ONE
            </span>
          </div>
          <span
            style={{
              fontSize: 124,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: -3,
              color: "oklch(0.24 0.04 60)",
            }}
          >
            One canvas.
            <br />
            <span style={{ opacity: subP }}>Every agent.</span>
          </span>
          <span
            style={{
              fontSize: 30,
              fontWeight: 500,
              lineHeight: 1.45,
              color: "oklch(0.46 0.04 60)",
              maxWidth: 860,
              opacity: accentP,
            }}
          >
            A coding canvas where Claude and Codex run side by side — and you bring it wherever you go.
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ── Beat 1 — Multi-harness ───────────────────────────────────────────────────

function Beat1MultiHarness() {
  const frame = useCurrentFrame()
  const switchAt = sec(5.0)
  const harness: Harness = frame >= switchAt ? "codex" : "claude"
  const hue = harness === "codex" ? HARNESS_CODEX_HUE : HARNESS_CLAUDE_HUE
  return (
    <AbsoluteFill>
      <WarmBackdrop hue={hue} />
      <AppStage
        hue={hue}
        bgChroma={0.04}
        windowW={1480}
        windowH={925}
        top={70}
        zoom={[
          { frame: 0, scale: 1.0, x: 0.5, y: 0.5 },
          { frame: sec(11), scale: 1.05, x: 0.45, y: 0.45 },
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
      <ShortcutHint
        keys={["⌘", "N"]}
        label="New session"
        x={FEATURE_WIDTH / 2}
        y={150}
        enter={sec(0.6)}
        exit={sec(4.4)}
        pressAt={sec(1.2)}
      />
      <ShortcutHint
        keys={["Tab"]}
        label="Switch harness"
        x={FEATURE_WIDTH / 2}
        y={150}
        enter={sec(4.5)}
        exit={sec(7.6)}
        pressAt={sec(4.9)}
      />
      <Caption
        text="Claude and Codex live in the same canvas. Pick the right mind for every task."
        kicker="ONE WORKSPACE  ·  EITHER MIND"
        enter={sec(0.6)}
        exit={sec(11.4)}
      />
    </AbsoluteFill>
  )
}

// ── Beat 2 — Markdown rendering ──────────────────────────────────────────────

function Beat2Markdown() {
  const frame = useCurrentFrame()
  // Slowly pan/zoom across the markdown gallery.
  const pan = interpolate(frame, [0, sec(15)], [-20, -360], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const scale = interpolate(frame, [0, sec(15)], [1.05, 1.14], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <AbsoluteFill>
      <WarmBackdrop hue={42} />
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
          brandHue={42}
          darkMode={false}
        />
      </div>
      <Caption
        text="Every block — tables, diffs, Mermaid, math, tool cards — rendered like print, not a wall of text."
        kicker="LIVE MARKDOWN"
        enter={sec(0.5)}
        exit={sec(14.4)}
      />
    </AbsoluteFill>
  )
}

// ── Beat 3 — Mini-apps ───────────────────────────────────────────────────────

function Beat3MiniApps() {
  const frame = useCurrentFrame()
  const showDrawer = frame >= sec(6.0)
  const showFullscreen = frame >= sec(11.0)
  const hue = HARNESS_CLAUDE_HUE
  const slot1 = { x: mapX(STAGE, 150), y: mapY(STAGE, 250) }
  return (
    <AbsoluteFill>
      <WarmBackdrop hue={hue} />
      {!showFullscreen ? (
        <AppStage
          hue={hue}
          bgChroma={0.04}
          windowW={1480}
          windowH={925}
          top={70}
          zoom={
            showDrawer
              ? [
                  { frame: 0, scale: 1.0, x: 0.5, y: 0.5 },
                  { frame: sec(0.6), scale: 1.18, x: 0.12, y: 0.26 },
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
              fps={INTRO_V2_FPS}
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
          bgChroma={0.04}
          windowW={1480}
          windowH={925}
          top={70}
          zoom={[
            { frame: 0, scale: 1.04, x: 0.5, y: 0.5 },
            { frame: sec(4.6), scale: 1.0, x: 0.5, y: 0.5 },
          ]}
        >
          <BrandScope brandHue={hue}>
            <MiniAppFullscreenShell appName="Sprint Board" appVersion="v1.0.0">
              <KanbanBody />
            </MiniAppFullscreenShell>
          </BrandScope>
        </AppStage>
      )}
      {showDrawer && !showFullscreen ? (
        <>
          <ShortcutHint
            keys={["1"]}
            label="Open mini-app"
            x={FEATURE_WIDTH / 2}
            y={150}
            enter={sec(6.4)}
            exit={sec(11.0)}
            pressAt={sec(10.3)}
          />
          <Cursor
            path={[
              { frame: sec(7.0), x: 760, y: 540 },
              { frame: sec(9.6), x: slot1.x, y: slot1.y },
              { frame: sec(10.2), x: slot1.x, y: slot1.y, click: true },
            ]}
          />
        </>
      ) : null}
      <Caption
        text="Describe an app in plain words — the agent scaffolds, packs and installs it."
        kicker="AGENT-BUILT APPS"
        enter={sec(0.5)}
        exit={sec(15.4)}
      />
    </AbsoluteFill>
  )
}

// ── Beat 4 — Remote control + privacy ───────────────────────────────────────

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
        boxShadow: "0 44px 90px -24px rgba(40,28,10,0.62)",
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

function Beat4Remote() {
  const frame = useCurrentFrame()
  const showPhone = frame >= sec(2.0)
  const showPermission = frame >= sec(8.0)
  const showChips = frame >= sec(13.0)

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

  const hue = HARNESS_CLAUDE_HUE
  return (
    <AbsoluteFill>
      <WarmBackdrop hue={hue} />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 100,
          transform: `translateX(calc(-50% + ${desktopShift}px))`,
          width: 1240,
          height: 776,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 50px 110px -30px rgba(60,40,15,0.55), 0 0 0 1px rgba(0,0,0,0.04)",
            opacity: showChips ? 0.55 : 1,
            transition: "opacity 0.4s",
          }}
        >
          <div
            style={{
              width: 1280,
              height: 800,
              transform: `scale(${1240 / 1280})`,
              transformOrigin: "top left",
            }}
          >
            <BrandScope brandHue={hue}>
              <ChatMock
                title="Bump relay worker to 0.4"
                harness="claude"
                messages={REMOTE_SESSION}
                frame={frame}
                fps={INTRO_V2_FPS}
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
            top: 92,
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
              <BrandScope brandHue={hue}>
                <ChatBody
                  messages={REMOTE_SESSION}
                  frame={frame}
                  fps={INTRO_V2_FPS}
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
        <PrivacyChips
          enter={sec(13.0)}
          x={520}
          y={620}
          variant="light"
          hue={152}
        />
      ) : null}

      <Caption
        text={
          frame < sec(12)
            ? "Your desktop session, mirrored live — answer the agent from your pocket."
            : "Privacy first: we never store your data, and every byte (files included) is end-to-end encrypted."
        }
        kicker={frame < sec(12) ? "REMOTE CONTROL" : "PRIVACY FIRST"}
        enter={sec(0.6)}
        exit={sec(19.4)}
      />
    </AbsoluteFill>
  )
}

// ── Outro ────────────────────────────────────────────────────────────────────

function ManifestoOutro() {
  const frame = useCurrentFrame()
  const inP = interpolate(frame, [0, sec(0.8)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  const exit = interpolate(frame, [sec(5.0), sec(6.0)], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const op = Math.min(inP, exit)
  return (
    <AbsoluteFill>
      <WarmBackdrop hue={42} />
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
            gap: 24,
            transform: `translateY(${(1 - inP) * 18}px)`,
          }}
        >
          <SuperOneMark size={96} hue={42} />
          <Wordmark size={56} hue={42} />
          <span
            style={{
              fontSize: 26,
              fontWeight: 500,
              color: "oklch(0.46 0.04 60)",
              letterSpacing: 0.2,
            }}
          >
            Your canvas. Your agent. Anywhere.
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ── Composition root ────────────────────────────────────────────────────────

export const introV2ManifestoDefaultProps = {}

export function IntroV2Manifesto() {
  let offset = 0
  const beats: { len: number; el: React.ReactNode }[] = [
    { len: COLD, el: <ColdOpen /> },
    { len: B1, el: <Beat1MultiHarness /> },
    { len: B2, el: <Beat2Markdown /> },
    { len: B3, el: <Beat3MiniApps /> },
    { len: B4, el: <Beat4Remote /> },
    { len: OUTRO, el: <ManifestoOutro /> },
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
