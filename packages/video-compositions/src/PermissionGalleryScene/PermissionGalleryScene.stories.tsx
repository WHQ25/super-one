import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  PERMISSION_GALLERY_DURATION_IN_FRAMES,
  PERMISSION_GALLERY_FPS,
  PERMISSION_GALLERY_HEIGHT,
  PERMISSION_GALLERY_WIDTH,
  PermissionGalleryScene,
  permissionGallerySceneDefaultProps,
} from "./index"
import { PlayerStage } from "../storybook/PlayerStage"

const meta: Meta = {
  title: "Video Compositions/Permission Gallery",
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof permissionGallerySceneDefaultProps>

export const Player: Story = {
  args: permissionGallerySceneDefaultProps,
  render: (args) => (
    <PlayerStage
      component={PermissionGalleryScene}
      inputProps={args}
      durationInFrames={PERMISSION_GALLERY_DURATION_IN_FRAMES}
      fps={PERMISSION_GALLERY_FPS}
      compositionWidth={PERMISSION_GALLERY_WIDTH}
      compositionHeight={PERMISSION_GALLERY_HEIGHT}
      displayWidth={1280}
    />
  ),
}
