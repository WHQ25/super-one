import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  ASK_USER_QUESTION_DURATION_IN_FRAMES,
  ASK_USER_QUESTION_FPS,
  ASK_USER_QUESTION_HEIGHT,
  ASK_USER_QUESTION_WIDTH,
  AskUserQuestionScene,
  askUserQuestionSceneDefaultProps,
} from "./index"
import { PlayerStage } from "../storybook/PlayerStage"

const meta: Meta = {
  title: "Video Compositions/Ask User Question",
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof askUserQuestionSceneDefaultProps>

export const Player: Story = {
  args: askUserQuestionSceneDefaultProps,
  render: (args) => (
    <PlayerStage
      component={AskUserQuestionScene}
      inputProps={args}
      durationInFrames={ASK_USER_QUESTION_DURATION_IN_FRAMES}
      fps={ASK_USER_QUESTION_FPS}
      compositionWidth={ASK_USER_QUESTION_WIDTH}
      compositionHeight={ASK_USER_QUESTION_HEIGHT}
      displayWidth={1280}
    />
  ),
}
