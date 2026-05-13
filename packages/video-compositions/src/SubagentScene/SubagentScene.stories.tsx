import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  SUBAGENT_DURATION_IN_FRAMES,
  SUBAGENT_FPS,
  SUBAGENT_HEIGHT,
  SUBAGENT_WIDTH,
  SubagentScene,
  subagentSceneDefaultProps,
} from "./index"
import { PlayerStage } from "../storybook/PlayerStage"

const meta: Meta = {
  title: "Video Compositions/Subagent",
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof subagentSceneDefaultProps>

export const Player: Story = {
  args: subagentSceneDefaultProps,
  render: (args) => (
    <PlayerStage
      component={SubagentScene}
      inputProps={args}
      durationInFrames={SUBAGENT_DURATION_IN_FRAMES}
      fps={SUBAGENT_FPS}
      compositionWidth={SUBAGENT_WIDTH}
      compositionHeight={SUBAGENT_HEIGHT}
      displayWidth={1280}
    />
  ),
}
