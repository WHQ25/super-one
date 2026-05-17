import type { Meta, StoryObj } from "@storybook/react-vite"
import { HARNESS_CODEX_HUE } from "@superone/desktop-mocks"
import {
  NEW_SESSION_DURATION_IN_FRAMES,
  NEW_SESSION_FPS,
  NEW_SESSION_HEIGHT,
  NEW_SESSION_WIDTH,
  NewSessionScene,
  newSessionSceneDefaultProps,
} from "./index"
import { PlayerStage } from "../storybook/PlayerStage"

const meta: Meta = {
  title: "Video Compositions/New Session",
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof newSessionSceneDefaultProps>

export const Player: Story = {
  args: newSessionSceneDefaultProps,
  render: (args) => (
    <PlayerStage
      component={NewSessionScene}
      inputProps={args}
      durationInFrames={NEW_SESSION_DURATION_IN_FRAMES}
      fps={NEW_SESSION_FPS}
      compositionWidth={NEW_SESSION_WIDTH}
      compositionHeight={NEW_SESSION_HEIGHT}
      displayWidth={1280}
    />
  ),
}

export const Codex: Story = {
  args: { ...newSessionSceneDefaultProps, startHarness: "codex", brandHue: HARNESS_CODEX_HUE },
  render: (args) => (
    <PlayerStage
      component={NewSessionScene}
      inputProps={args}
      durationInFrames={NEW_SESSION_DURATION_IN_FRAMES}
      fps={NEW_SESSION_FPS}
      compositionWidth={NEW_SESSION_WIDTH}
      compositionHeight={NEW_SESSION_HEIGHT}
      displayWidth={1280}
    />
  ),
}
