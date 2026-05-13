import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  FILE_PREVIEW_DURATION_IN_FRAMES,
  FILE_PREVIEW_FPS,
  FILE_PREVIEW_HEIGHT,
  FILE_PREVIEW_WIDTH,
  FilePreviewScene,
  filePreviewSceneDefaultProps,
} from "./index"
import { PlayerStage } from "../storybook/PlayerStage"

const meta: Meta = {
  title: "Video Compositions/File Preview",
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof filePreviewSceneDefaultProps>

export const Player: Story = {
  args: filePreviewSceneDefaultProps,
  render: (args) => (
    <PlayerStage
      component={FilePreviewScene}
      inputProps={args}
      durationInFrames={FILE_PREVIEW_DURATION_IN_FRAMES}
      fps={FILE_PREVIEW_FPS}
      compositionWidth={FILE_PREVIEW_WIDTH}
      compositionHeight={FILE_PREVIEW_HEIGHT}
      displayWidth={1280}
    />
  ),
}
