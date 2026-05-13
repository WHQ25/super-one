import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  PLAN_APPROVAL_DURATION_IN_FRAMES,
  PLAN_APPROVAL_FPS,
  PLAN_APPROVAL_HEIGHT,
  PLAN_APPROVAL_WIDTH,
  PlanApprovalScene,
  planApprovalSceneDefaultProps,
} from "./index"
import { PlayerStage } from "../storybook/PlayerStage"

const meta: Meta = {
  title: "Video Compositions/Plan Approval",
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof planApprovalSceneDefaultProps>

export const Player: Story = {
  args: planApprovalSceneDefaultProps,
  render: (args) => (
    <PlayerStage
      component={PlanApprovalScene}
      inputProps={args}
      durationInFrames={PLAN_APPROVAL_DURATION_IN_FRAMES}
      fps={PLAN_APPROVAL_FPS}
      compositionWidth={PLAN_APPROVAL_WIDTH}
      compositionHeight={PLAN_APPROVAL_HEIGHT}
      displayWidth={1280}
    />
  ),
}
