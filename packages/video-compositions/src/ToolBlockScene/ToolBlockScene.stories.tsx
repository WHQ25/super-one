import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  TOOL_BLOCK_DURATION_IN_FRAMES,
  TOOL_BLOCK_FPS,
  TOOL_BLOCK_HEIGHT,
  TOOL_BLOCK_WIDTH,
  ToolBlockScene,
  toolBlockSceneDefaultProps,
} from "./index"
import { PlayerStage } from "../storybook/PlayerStage"

const meta: Meta = {
  title: "Video Compositions/Tool Block",
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof toolBlockSceneDefaultProps>

export const Player: Story = {
  args: toolBlockSceneDefaultProps,
  render: (args) => (
    <PlayerStage
      component={ToolBlockScene}
      inputProps={args}
      durationInFrames={TOOL_BLOCK_DURATION_IN_FRAMES}
      fps={TOOL_BLOCK_FPS}
      compositionWidth={TOOL_BLOCK_WIDTH}
      compositionHeight={TOOL_BLOCK_HEIGHT}
      displayWidth={1280}
    />
  ),
}
