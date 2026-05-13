import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  MARKDOWN_GALLERY_DURATION_IN_FRAMES,
  MARKDOWN_GALLERY_FPS,
  MARKDOWN_GALLERY_HEIGHT,
  MARKDOWN_GALLERY_WIDTH,
  MarkdownGalleryScene,
  markdownGallerySceneDefaultProps,
} from "./index"
import { PlayerStage } from "../storybook/PlayerStage"

const meta: Meta = {
  title: "Video Compositions/Markdown Gallery",
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof markdownGallerySceneDefaultProps>

export const Player: Story = {
  args: markdownGallerySceneDefaultProps,
  render: (args) => (
    <PlayerStage
      component={MarkdownGalleryScene}
      inputProps={args}
      durationInFrames={MARKDOWN_GALLERY_DURATION_IN_FRAMES}
      fps={MARKDOWN_GALLERY_FPS}
      compositionWidth={MARKDOWN_GALLERY_WIDTH}
      compositionHeight={MARKDOWN_GALLERY_HEIGHT}
      displayWidth={1280}
    />
  ),
}
