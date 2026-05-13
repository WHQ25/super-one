import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import {
  BrandScope,
  HARNESS_CLAUDE_HUE,
  NewSessionMock,
  type Harness,
} from "@superone/desktop-mocks"

export const NEW_SESSION_FPS = 30
export const NEW_SESSION_WIDTH = 1280
export const NEW_SESSION_HEIGHT = 800
export const NEW_SESSION_DURATION_IN_FRAMES = 10 * NEW_SESSION_FPS

export type NewSessionSceneProps = {
  startHarness: Harness
  brandHue: number
  darkMode: boolean
}

export const newSessionSceneDefaultProps: NewSessionSceneProps = {
  startHarness: "claude",
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

export const NewSessionScene = ({ startHarness, brandHue, darkMode }: NewSessionSceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps

  const other: Harness = startHarness === "claude" ? "codex" : "claude"
  const harness: Harness = t < 3 ? startHarness : t < 5 ? other : startHarness

  const recentProjectsOpen = t >= 5.4 && t < 8.5
  const selectedProject = t >= 7.6 ? "marketing-site" : "super-one"

  const shellScale = interpolate(frame, [0, 0.6 * fps], [0.96, 1], {
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
          style={{
            width: 1232,
            height: 752,
            transform: `scale(${shellScale})`,
            opacity: shellOpacity,
          }}
          className="overflow-hidden rounded-2xl shadow-2xl ring-1 ring-border/60"
        >
          <NewSessionMock
            harness={harness}
            frame={frame}
            recentProjectsOpen={recentProjectsOpen}
            selectedProject={selectedProject}
            showTrafficLights
          />
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}
