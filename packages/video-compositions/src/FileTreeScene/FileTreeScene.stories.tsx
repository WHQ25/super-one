import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  FILE_TREE_DURATION_IN_FRAMES,
  FILE_TREE_FPS,
  FILE_TREE_HEIGHT,
  FILE_TREE_WIDTH,
  FileTreeScene,
  fileTreeSceneDefaultProps,
} from "./index"
import { PlayerStage } from "../storybook/PlayerStage"

const meta: Meta = {
  title: "Video Compositions/File Tree",
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof fileTreeSceneDefaultProps>

export const Player: Story = {
  args: fileTreeSceneDefaultProps,
  render: (args) => (
    <PlayerStage
      component={FileTreeScene}
      inputProps={args}
      durationInFrames={FILE_TREE_DURATION_IN_FRAMES}
      fps={FILE_TREE_FPS}
      compositionWidth={FILE_TREE_WIDTH}
      compositionHeight={FILE_TREE_HEIGHT}
      displayWidth={1280}
    />
  ),
}
