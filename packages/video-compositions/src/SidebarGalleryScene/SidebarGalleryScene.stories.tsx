import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  SIDEBAR_GALLERY_DURATION_IN_FRAMES,
  SIDEBAR_GALLERY_FPS,
  SIDEBAR_GALLERY_HEIGHT,
  SIDEBAR_GALLERY_WIDTH,
  SidebarGalleryScene,
  sidebarGallerySceneDefaultProps,
} from "./index"
import { PlayerStage } from "../storybook/PlayerStage"

const meta: Meta = {
  title: "Video Compositions/Sidebar Gallery",
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof sidebarGallerySceneDefaultProps>

export const Player: Story = {
  args: sidebarGallerySceneDefaultProps,
  render: (args) => (
    <PlayerStage
      component={SidebarGalleryScene}
      inputProps={args}
      durationInFrames={SIDEBAR_GALLERY_DURATION_IN_FRAMES}
      fps={SIDEBAR_GALLERY_FPS}
      compositionWidth={SIDEBAR_GALLERY_WIDTH}
      compositionHeight={SIDEBAR_GALLERY_HEIGHT}
      displayWidth={1280}
    />
  ),
}
