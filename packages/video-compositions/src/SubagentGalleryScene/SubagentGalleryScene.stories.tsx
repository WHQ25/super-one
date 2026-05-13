import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  SUBAGENT_GALLERY_DURATION_IN_FRAMES,
  SUBAGENT_GALLERY_FPS,
  SUBAGENT_GALLERY_HEIGHT,
  SUBAGENT_GALLERY_WIDTH,
  SubagentGalleryScene,
  subagentGallerySceneDefaultProps,
} from "./index"
import { PlayerStage } from "../storybook/PlayerStage"

const meta: Meta = {
  title: "Video Compositions/Subagent Gallery",
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof subagentGallerySceneDefaultProps>

export const Player: Story = {
  args: subagentGallerySceneDefaultProps,
  render: (args) => (
    <PlayerStage
      component={SubagentGalleryScene}
      inputProps={args}
      durationInFrames={SUBAGENT_GALLERY_DURATION_IN_FRAMES}
      fps={SUBAGENT_GALLERY_FPS}
      compositionWidth={SUBAGENT_GALLERY_WIDTH}
      compositionHeight={SUBAGENT_GALLERY_HEIGHT}
      displayWidth={1440}
    />
  ),
}
