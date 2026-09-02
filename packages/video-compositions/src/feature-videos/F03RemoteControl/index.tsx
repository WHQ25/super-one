// Feature 03 — Remote Control: drive your desktop sessions from your phone.

import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion"
import {
  ChatBody,
  ChatMock,
  PermissionPromptMock,
  HARNESS_CLAUDE_HUE,
  type MockMessage,
} from "@superone/desktop-mocks"
import {
  AppStage,
  Caption,
  Cursor,
  EASE_OUT,
  FeatureVideo,
  fadeWindow,
  featureVideoDuration,
  makeStage,
  mapX,
  mapY,
  rand01,
  sec,
  type FeatureBeat,
} from "../../feature-kit/index"

export const REMOTE_CONTROL_FPS = 30
export const REMOTE_CONTROL_WIDTH = 1920
export const REMOTE_CONTROL_HEIGHT = 1080

const STAGE = makeStage()

const SESSION: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Bump the relay worker to 0.4 and redeploy.",
  },
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

// ── Fake QR code ────────────────────────────────────────────────────────────
function QrCode({ size = 168 }: { size?: number }): React.ReactNode {
  const n = 21
  const cell = size / n
  const isFinder = (r: number, c: number): boolean => {
    const inBox = (br: number, bc: number) =>
      r >= br && r < br + 7 && c >= bc && c < bc + 7
    return inBox(0, 0) || inBox(0, n - 7) || inBox(n - 7, 0)
  }
  const cells: React.ReactNode[] = []
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      let on = false
      if (isFinder(r, c)) {
        const lr = r >= n - 7 ? r - (n - 7) : r
        const lc = c >= n - 7 ? c - (n - 7) : c
        const ring = lr === 0 || lr === 6 || lc === 0 || lc === 6
        const core = lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4
        on = ring || core
      } else {
        on = rand01("qr", r * n + c) > 0.52
      }
      if (!on) continue
      cells.push(
        <div
          key={`${r}-${c}`}
          style={{
            position: "absolute",
            left: c * cell,
            top: r * cell,
            width: cell + 0.6,
            height: cell + 0.6,
            background: "oklch(0.26 0.03 60)",
          }}
        />,
      )
    }
  }
  return (
    <div style={{ position: "relative", width: size, height: size }}>{cells}</div>
  )
}

// ── Phone frame containing a chat ───────────────────────────────────────────
function PhoneFrame({
  children,
  width = 392,
}: {
  children: React.ReactNode
  width?: number
}): React.ReactNode {
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

// ── Beat A — pair the phone ─────────────────────────────────────────────────
function BeatPair(): React.ReactNode {
  const frame = useCurrentFrame()
  const remoteIcon = { x: mapX(STAGE, 76), y: mapY(STAGE, 778) }
  const cardOpacity = fadeWindow(frame, sec(3.4), sec(5.8), sec(0.4))
  const cardPop = interpolate(frame, [sec(3.4), sec(3.8)], [0.9, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  return (
    <AbsoluteFill>
      <AppStage hue={HARNESS_CLAUDE_HUE}>
        <ChatMock
          title="Bump relay worker to 0.4"
          harness="claude"
          messages={SESSION}
          fps={REMOTE_CONTROL_FPS}
          showFooter={false}
        />
      </AppStage>
      <Cursor
        path={[
          { frame: sec(0.8), x: 900, y: 540 },
          { frame: sec(3.0), x: remoteIcon.x, y: remoteIcon.y },
          { frame: sec(3.3), x: remoteIcon.x, y: remoteIcon.y, click: true },
        ]}
      />
      <div
        style={{
          position: "absolute",
          left: 360,
          top: 392,
          opacity: cardOpacity,
          transform: `scale(${cardPop})`,
          transformOrigin: "left bottom",
          display: "flex",
          gap: 22,
          alignItems: "center",
          padding: 26,
          borderRadius: 22,
          background: "#fff",
          border: "1px solid oklch(0.88 0.014 70)",
          boxShadow: "0 32px 70px -20px rgba(40,28,10,0.5)",
        }}
      >
        <div style={{ padding: 12, background: "oklch(0.97 0.01 75)", borderRadius: 14 }}>
          <QrCode size={150} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 252 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: "oklch(0.28 0.03 60)" }}>
            Pair your phone
          </span>
          <span style={{ fontSize: 15, lineHeight: 1.45, color: "oklch(0.5 0.03 60)" }}>
            Scan with the SuperOne app to link this desktop. End-to-end encrypted over the relay.
          </span>
          <span
            style={{
              marginTop: 4,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1.5,
              color: "oklch(0.6 0.15 42)",
            }}
          >
            LAN · OR · RELAY
          </span>
        </div>
      </div>
      <Caption
        text="Pair your phone with one scan — encrypted, over LAN or the relay."
        kicker="REMOTE CONTROL"
        enter={sec(0.5)}
        exit={sec(5.8)}
      />
    </AbsoluteFill>
  )
}

// ── Split desktop + phone, mirrored ─────────────────────────────────────────
function MirrorStage({
  frame,
  phoneFocus,
  permissionOnPhone,
}: {
  frame: number
  phoneFocus: boolean
  permissionOnPhone?: boolean
}): React.ReactNode {
  const enter = interpolate(frame, [0, sec(0.7)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  const deskW = phoneFocus ? 980 : 1140
  const deskScale = deskW / 1280
  const deskH = 800 * deskScale
  const phoneW = phoneFocus ? 452 : 392
  const desktopX = phoneFocus ? 150 : 196
  const phoneX = phoneFocus ? 1234 : 1212

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, oklch(0.96 0.014 42), oklch(0.93 0.024 42))`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: desktopX,
          top: 220,
          width: deskW,
          height: deskH,
          opacity: enter * (phoneFocus ? 0.78 : 1),
          transform: `scale(${interpolate(enter, [0, 1], [0.97, 1])})`,
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 42px 90px -28px rgba(60,40,15,0.5)",
        }}
      >
        <div
          style={{
            width: 1280,
            height: 800,
            transform: `scale(${deskScale})`,
            transformOrigin: "top left",
          }}
        >
          <ChatMock
            title="Bump relay worker to 0.4 · remote"
            harness="claude"
            messages={SESSION}
            frame={frame}
            fps={REMOTE_CONTROL_FPS}
            typingCps={70}
            userPauseMs={500}
            assistantPauseMs={400}
            remoteOnline
          />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: phoneX,
          top: phoneFocus ? 70 : 110,
          opacity: enter,
          transform: `scale(${interpolate(enter, [0, 1], [0.94, 1])})`,
          transformOrigin: "center",
        }}
      >
        <PhoneFrame width={phoneW}>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 50,
              bottom: 0,
              background: "var(--card, #fff)",
            }}
          >
            <ChatBody
              messages={SESSION}
              frame={frame}
              fps={REMOTE_CONTROL_FPS}
              typingCps={70}
              userPauseMs={500}
              assistantPauseMs={400}
              harness="claude"
              showFooter={false}
              permissionPrompt={
                permissionOnPhone ? (
                  <PermissionPromptMock
                    spec={{ variant: "bash", command: "wrangler deploy" }}
                    description="publish relay worker 0.4"
                    focusedAction="allow"
                  />
                ) : undefined
              }
            />
          </div>
        </PhoneFrame>
      </div>
    </AbsoluteFill>
  )
}

function BeatMirror(): React.ReactNode {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill>
      <MirrorStage frame={frame} phoneFocus={false} />
      <Caption
        text="Your desktop session, mirrored live — the same turn streams to both screens."
        kicker="ONE SESSION · TWO SCREENS"
        enter={sec(0.6)}
        exit={sec(7.4)}
      />
    </AbsoluteFill>
  )
}

function BeatApprove(): React.ReactNode {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill>
      <MirrorStage frame={frame} phoneFocus permissionOnPhone />
      <Caption
        text="Approve a tool call — or steer the agent — straight from your pocket."
        kicker="APPROVE ANYWHERE"
        enter={sec(0.6)}
        exit={sec(6.4)}
      />
    </AbsoluteFill>
  )
}

const BEATS: FeatureBeat[] = [
  { durationInFrames: sec(6.2), content: <BeatPair /> },
  { durationInFrames: sec(7.8), content: <BeatMirror /> },
  { durationInFrames: sec(6.8), content: <BeatApprove /> },
]

export const REMOTE_CONTROL_DURATION_IN_FRAMES = featureVideoDuration(BEATS)
export const remoteControlDefaultProps = {}

export function RemoteControlVideo(): React.ReactNode {
  return (
    <FeatureVideo
      index={3}
      title={"Your desktop,\nin your pocket."}
      subtitle="Pair your phone and drive any SuperOne session remotely — watch turns stream, answer questions, approve tools from anywhere."
      hue={HARNESS_CLAUDE_HUE}
      beats={BEATS}
      outroTagline="Run your agents from anywhere."
    />
  )
}
