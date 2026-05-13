import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  MINIAPP_FULLSCREEN_DURATION_IN_FRAMES,
  MINIAPP_FULLSCREEN_FPS,
  MINIAPP_FULLSCREEN_HEIGHT,
  MINIAPP_FULLSCREEN_WIDTH,
  MiniAppFullscreenScene,
  miniAppFullscreenSceneDefaultProps,
} from "./index"
import { PlayerStage } from "../storybook/PlayerStage"

const meta: Meta = {
  title: "Video Compositions/MiniApp Fullscreen",
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof miniAppFullscreenSceneDefaultProps>

export const Player: Story = {
  args: miniAppFullscreenSceneDefaultProps,
  render: (args) => (
    <PlayerStage
      component={MiniAppFullscreenScene}
      inputProps={args}
      durationInFrames={MINIAPP_FULLSCREEN_DURATION_IN_FRAMES}
      fps={MINIAPP_FULLSCREEN_FPS}
      compositionWidth={MINIAPP_FULLSCREEN_WIDTH}
      compositionHeight={MINIAPP_FULLSCREEN_HEIGHT}
      displayWidth={1280}
    />
  ),
}

export const PlayerDark: Story = {
  args: { ...miniAppFullscreenSceneDefaultProps, darkMode: true },
  render: (args) => (
    <PlayerStage
      component={MiniAppFullscreenScene}
      inputProps={args}
      durationInFrames={MINIAPP_FULLSCREEN_DURATION_IN_FRAMES}
      fps={MINIAPP_FULLSCREEN_FPS}
      compositionWidth={MINIAPP_FULLSCREEN_WIDTH}
      compositionHeight={MINIAPP_FULLSCREEN_HEIGHT}
      displayWidth={1280}
    />
  ),
}

export const PlayerCodex: Story = {
  args: { ...miniAppFullscreenSceneDefaultProps, harness: "codex", brandHue: 165 },
  render: (args) => (
    <PlayerStage
      component={MiniAppFullscreenScene}
      inputProps={args}
      durationInFrames={MINIAPP_FULLSCREEN_DURATION_IN_FRAMES}
      fps={MINIAPP_FULLSCREEN_FPS}
      compositionWidth={MINIAPP_FULLSCREEN_WIDTH}
      compositionHeight={MINIAPP_FULLSCREEN_HEIGHT}
      displayWidth={1280}
    />
  ),
}
