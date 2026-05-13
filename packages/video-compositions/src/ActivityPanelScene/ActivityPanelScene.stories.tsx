import type { Meta, StoryObj } from "@storybook/react-vite"
import { HARNESS_CODEX_HUE } from "@superone/desktop-mocks"
import {
  ACTIVITY_PANEL_DURATION_IN_FRAMES,
  ACTIVITY_PANEL_FPS,
  ACTIVITY_PANEL_HEIGHT,
  ACTIVITY_PANEL_WIDTH,
  ActivityPanelScene,
  activityPanelSceneDefaultProps,
} from "./index"
import { PlayerStage } from "../storybook/PlayerStage"

const meta: Meta = {
  title: "Video Compositions/Activity Panel",
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof activityPanelSceneDefaultProps>

export const Player: Story = {
  args: activityPanelSceneDefaultProps,
  render: (args) => (
    <PlayerStage
      component={ActivityPanelScene}
      inputProps={args}
      durationInFrames={ACTIVITY_PANEL_DURATION_IN_FRAMES}
      fps={ACTIVITY_PANEL_FPS}
      compositionWidth={ACTIVITY_PANEL_WIDTH}
      compositionHeight={ACTIVITY_PANEL_HEIGHT}
      displayWidth={1280}
    />
  ),
}

export const Light: Story = {
  args: { ...activityPanelSceneDefaultProps, darkMode: false },
  render: (args) => (
    <PlayerStage
      component={ActivityPanelScene}
      inputProps={args}
      durationInFrames={ACTIVITY_PANEL_DURATION_IN_FRAMES}
      fps={ACTIVITY_PANEL_FPS}
      compositionWidth={ACTIVITY_PANEL_WIDTH}
      compositionHeight={ACTIVITY_PANEL_HEIGHT}
      displayWidth={1280}
    />
  ),
}

export const Codex: Story = {
  args: { ...activityPanelSceneDefaultProps, harness: "codex", brandHue: HARNESS_CODEX_HUE },
  render: (args) => (
    <PlayerStage
      component={ActivityPanelScene}
      inputProps={args}
      durationInFrames={ACTIVITY_PANEL_DURATION_IN_FRAMES}
      fps={ACTIVITY_PANEL_FPS}
      compositionWidth={ACTIVITY_PANEL_WIDTH}
      compositionHeight={ACTIVITY_PANEL_HEIGHT}
      displayWidth={1280}
    />
  ),
}

export const Autoplay: Story = {
  args: activityPanelSceneDefaultProps,
  render: (args) => (
    <PlayerStage
      component={ActivityPanelScene}
      inputProps={args}
      durationInFrames={ACTIVITY_PANEL_DURATION_IN_FRAMES}
      fps={ACTIVITY_PANEL_FPS}
      compositionWidth={ACTIVITY_PANEL_WIDTH}
      compositionHeight={ACTIVITY_PANEL_HEIGHT}
      displayWidth={1280}
      autoPlay
    />
  ),
}
