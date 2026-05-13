import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  TOOL_GALLERY_DURATION_IN_FRAMES,
  TOOL_GALLERY_FPS,
  TOOL_GALLERY_HEIGHT,
  TOOL_GALLERY_WIDTH,
  ToolBlockGalleryScene,
  toolBlockGallerySceneDefaultProps,
} from "./index"
import { PlayerStage } from "../storybook/PlayerStage"

const meta: Meta = {
  title: "Video Compositions/Tool Block Gallery",
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof toolBlockGallerySceneDefaultProps>

export const Player: Story = {
  args: toolBlockGallerySceneDefaultProps,
  render: (args) => (
    <PlayerStage
      component={ToolBlockGalleryScene}
      inputProps={args}
      durationInFrames={TOOL_GALLERY_DURATION_IN_FRAMES}
      fps={TOOL_GALLERY_FPS}
      compositionWidth={TOOL_GALLERY_WIDTH}
      compositionHeight={TOOL_GALLERY_HEIGHT}
      displayWidth={1280}
    />
  ),
}
