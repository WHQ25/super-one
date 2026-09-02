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
import { EncryptionExchange } from "../shared/encryption-exchange"
import { PrivacyChips } from "../shared/privacy-chips"

export const INTRO_V4_FPS = 30
export const INTRO_V4_WIDTH = 1920
export const INTRO_V4_HEIGHT = 1080

const COLD = sec(8)
const CH1 = sec(14)
const CH2 = sec(12)
const CH3 = sec(14)
const CH4 = sec(16)
const OUTRO = sec(6)

export const INTRO_V4_DURATION_IN_FRAMES = COLD + CH1 + CH2 + CH3 + CH4 + OUTRO

const SLATE = 240

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
        background: "oklch(0.18 0.02 240)",
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
            background: "oklch(0.22 0.02 240)",
            borderRadius: 14,
            padding: 12,
            border: "1px solid oklch(0.32 0.03 240)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px 6px" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: col.tint }} />
            <span style={{ fontSize: 14, fontWeight: 650, color: "oklch(0.86 0.02 240)" }}>
              {col.title}
            </span>
            <span style={{ fontSize: 12, color: "oklch(0.6 0.02 240)" }}>{col.cards.length}</span>
          </div>
          {col.cards.map((card) => (
            <div
              key={card}
              style={{
                background: "oklch(0.28 0.02 240)",
                borderRadius: 10,
                padding: "11px 12px",
                fontSize: 13,
                fontWeight: 500,
                color: "oklch(0.88 0.02 240)",
                boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
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
        text: "Scaffolding a sandboxed mini-app that runs in its own process — it'll land in your Apps drawer.",
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

// ── Slate backdrop (cool, deep) ─────────────────────────────────────────────

function SlateBackdrop({ hue = SLATE, intensity = 1 }: { hue?: number; intensity?: number }) {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 90% at 50% 0%, oklch(0.22 ${0.05 * intensity} ${hue}) 0%, oklch(0.12 ${0.025 * intensity} ${hue}) 60%, #07080d 100%)`,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)",
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

// ── Cold open: closing lock ─────────────────────────────────────────────────

function LockGlyph({ progress, color }: { progress: number; color: string }) {
  // progress 0 = shackle open, 1 = closed flush against body
  const lift = interpolate(progress, [0, 1], [-18, 0])
  return (
    <svg width="220" height="260" viewBox="0 0 220 260" fill="none">
      <rect
        x="40"
        y="120"
        width="140"
        height="110"
        rx="20"
        stroke={color}
        strokeWidth="6"
      />
      <path
        d={`M68 120 V${75 + lift} a42 42 0 0 1 84 0 V120`}
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="110" cy="166" r="11" fill={color} />
      <path d="M110 168 V196" stroke={color} strokeWidth="6" strokeLinecap="round" />
    </svg>
  )
}

function ColdOpen() {
  const frame = useCurrentFrame()
  const lockProgress = interpolate(frame, [sec(0.4), sec(2.6)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  const flash = interpolate(frame, [sec(2.5), sec(2.85), sec(3.4)], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const morphOut = interpolate(frame, [sec(3.2), sec(4.0)], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const brandIn = interpolate(frame, [sec(3.8), sec(4.8)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  const lineIn = interpolate(frame, [sec(4.6), sec(5.6)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  const exit = fadeWindow(frame, 0, sec(8), sec(0.5))
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <SlateBackdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        {/* lock — visible during first half, then morphs out */}
        <div
          style={{
            position: "absolute",
            opacity: morphOut,
            transform: `scale(${interpolate(morphOut, [0, 1], [0.94, 1])})`,
          }}
        >
          {/* flash on lock */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: 420,
              height: 420,
              borderRadius: "50%",
              background: "radial-gradient(circle, oklch(0.7 0.16 240 / 0.6), transparent 70%)",
              opacity: flash,
              pointerEvents: "none",
            }}
          />
          <LockGlyph progress={lockProgress} color="oklch(0.86 0.12 240)" />
        </div>
        {/* brand mark fades in over the lock */}
        <div
          style={{
            position: "absolute",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 22,
            opacity: brandIn,
            transform: `translateY(${(1 - brandIn) * 18}px)`,
          }}
        >
          <SuperOneMark size={88} hue={SLATE} />
          <Wordmark size={48} hue={SLATE} />
          <span
            style={{
              marginTop: 8,
              fontSize: 32,
              fontWeight: 600,
              color: "#fbf6ee",
              letterSpacing: -0.6,
              textAlign: "center",
              maxWidth: 1080,
              opacity: lineIn,
            }}
          >
            We built this on your side of the screen.
          </span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 3.6,
              color: "oklch(0.74 0.14 240)",
              opacity: lineIn,
            }}
          >
            PRIVACY FIRST · BY DESIGN
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ── Ch.1 — Your harness ─────────────────────────────────────────────────────

function Chapter1Harness() {
  const frame = useCurrentFrame()
  const switchAt = sec(6.0)
  const harness: Harness = frame >= switchAt ? "codex" : "claude"
  return (
    <AbsoluteFill>
      <SlateBackdrop />
      <AppStage
        hue={SLATE}
        bgChroma={0}
        darkMode
        windowW={1440}
        windowH={900}
        top={140}
      >
        <BrandScope brandHue={harness === "codex" ? HARNESS_CODEX_HUE : HARNESS_CLAUDE_HUE}>
          <NewSessionMock
            harness={harness}
            frame={frame}
            selectedProject="super-one"
            appsExpanded={false}
          />
        </BrandScope>
      </AppStage>
      <ShortcutHint
        keys={["Tab"]}
        label="Switch harness"
        x={FEATURE_WIDTH / 2}
        y={70}
        enter={sec(4.6)}
        exit={sec(8.0)}
        pressAt={sec(5.6)}
      />
      <Caption
        text="Your harness. Your account. Your keys. Super One runs against the model account you already pay for — nothing is proxied through us."
        kicker="01 · YOUR MIND"
        enter={sec(0.6)}
        exit={sec(13.4)}
      />
    </AbsoluteFill>
  )
}

// ── Ch.2 — Your renderer ────────────────────────────────────────────────────

function Chapter2Markdown() {
  const frame = useCurrentFrame()
  const pan = interpolate(frame, [0, sec(12)], [-20, -300], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const scale = interpolate(frame, [0, sec(12)], [1.05, 1.12], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <AbsoluteFill>
      <SlateBackdrop intensity={0.7} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateY(${pan}px) scale(${scale})`,
          transformOrigin: "50% 28%",
        }}
      >
        <MarkdownGalleryScene harness="claude" brandHue={SLATE} darkMode />
      </div>
      <Caption
        text="Read the answer, not a wall of text. Markdown, code, diffs, Mermaid, math — all rendered locally on your machine."
        kicker="02 · YOUR RENDERER"
        enter={sec(0.6)}
        exit={sec(11.4)}
      />
    </AbsoluteFill>
  )
}

// ── Ch.3 — Your tools (mini-apps, sandboxed) ────────────────────────────────

function Chapter3MiniApps() {
  const frame = useCurrentFrame()
  const showDrawer = frame >= sec(5.5)
  const showFullscreen = frame >= sec(10.0)
  return (
    <AbsoluteFill>
      <SlateBackdrop />
      {!showFullscreen ? (
        <AppStage
          hue={SLATE}
          bgChroma={0}
          darkMode
          windowW={1440}
          windowH={900}
          top={140}
          zoom={
            showDrawer
              ? [
                  { frame: 0, scale: 1.0, x: 0.5, y: 0.5 },
                  { frame: sec(0.6), scale: 1.16, x: 0.12, y: 0.26 },
                ]
              : undefined
          }
        >
          <BrandScope brandHue={HARNESS_CLAUDE_HUE}>
            <ChatMock
              title="Build a sprint board mini-app"
              harness="claude"
              messages={BUILD_CHAT}
              frame={frame}
              fps={INTRO_V4_FPS}
              typingCps={150}
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
          hue={SLATE}
          bgChroma={0}
          darkMode
          windowW={1440}
          windowH={900}
          top={140}
        >
          <BrandScope brandHue={HARNESS_CLAUDE_HUE}>
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
          y={70}
          enter={sec(6.0)}
          exit={sec(10.0)}
          pressAt={sec(9.4)}
        />
      ) : null}
      <Caption
        text="Mini-apps your agent builds — sandboxed, run in their own process, never call home. Owned by you."
        kicker="03 · YOUR TOOLS"
        enter={sec(0.6)}
        exit={sec(13.4)}
      />
    </AbsoluteFill>
  )
}

// ── Ch.4 — Your devices (E2E remote) ────────────────────────────────────────

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

function Chapter4Remote() {
  const frame = useCurrentFrame()
  const showPhone = frame >= sec(1.6)
  const showExchange = frame >= sec(4.0)
  const showPermission = frame >= sec(7.5)
  const showChips = frame >= sec(10.5)
  const phoneSlide = interpolate(frame, [sec(1.6), sec(2.6)], [120, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  const phoneOp = interpolate(frame, [sec(1.6), sec(2.6)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const desktopShift = interpolate(frame, [sec(1.6), sec(2.6)], [0, -220], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  return (
    <AbsoluteFill>
      <SlateBackdrop />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 180,
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
            opacity: showChips ? 0.5 : 1,
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
            <BrandScope brandHue={HARNESS_CLAUDE_HUE}>
              <ChatMock
                title="Bump relay worker to 0.4"
                harness="claude"
                messages={REMOTE_SESSION}
                frame={frame}
                fps={INTRO_V4_FPS}
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
            right: 240,
            top: 130,
            opacity: phoneOp,
            transform: `translateY(${phoneSlide}px)`,
          }}
        >
          <PhoneFrame width={380}>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 46,
                bottom: 0,
                background: "var(--card, #fff)",
              }}
            >
              <BrandScope brandHue={HARNESS_CLAUDE_HUE}>
                <ChatBody
                  messages={REMOTE_SESSION}
                  frame={frame}
                  fps={INTRO_V4_FPS}
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
      {showExchange ? (
        <EncryptionExchange
          enter={sec(4.0)}
          x={FEATURE_WIDTH / 2}
          y={970}
          width={520}
          variant="dark"
        />
      ) : null}
      {showChips ? (
        <PrivacyChips enter={sec(10.5)} x={FEATURE_WIDTH / 2} y={540} variant="dark" hue={152} />
      ) : null}
      <Caption
        text={
          frame < sec(10)
            ? "Pair anywhere. The relay only sees ciphertext — your session, files included, is end-to-end encrypted."
            : "Three guarantees. No data stored on our relay. Every byte encrypted between your devices. LAN-direct whenever possible."
        }
        kicker="04 · YOUR DEVICES"
        enter={sec(0.6)}
        exit={sec(15.4)}
        y={920}
      />
    </AbsoluteFill>
  )
}

// ── Outro ────────────────────────────────────────────────────────────────────

function PrivacyOutro() {
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
      <SlateBackdrop />
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
          <SuperOneMark size={92} hue={SLATE} />
          <Wordmark size={56} hue={SLATE} />
          <span
            style={{
              fontSize: 26,
              fontWeight: 500,
              color: "#fbf6ee",
              letterSpacing: 0.2,
            }}
          >
            Super One — privacy is the default.
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ── Composition root ────────────────────────────────────────────────────────

export const introV4PrivacyFirstDefaultProps = {}

export function IntroV4PrivacyFirst() {
  let offset = 0
  const beats: { len: number; el: React.ReactNode }[] = [
    { len: COLD, el: <ColdOpen /> },
    { len: CH1, el: <Chapter1Harness /> },
    { len: CH2, el: <Chapter2Markdown /> },
    { len: CH3, el: <Chapter3MiniApps /> },
    { len: CH4, el: <Chapter4Remote /> },
    { len: OUTRO, el: <PrivacyOutro /> },
  ]
  return (
    <BrandScope brandHue={SLATE}>
      <AbsoluteFill style={{ background: "#07080d" }}>
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
