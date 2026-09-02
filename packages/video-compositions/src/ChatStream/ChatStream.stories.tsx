import type { Meta, StoryObj } from "@storybook/react-vite"
import { HARNESS_CODEX_HUE } from "@superone/desktop-mocks"
import {
  CHAT_STREAM_DURATION_IN_FRAMES,
  CHAT_STREAM_FPS,
  CHAT_STREAM_HEIGHT,
  CHAT_STREAM_WIDTH,
  ChatStream,
  chatStreamDefaultProps,
} from "./index"
import { PlayerStage } from "../storybook/PlayerStage"

const meta: Meta = {
  title: "Video Compositions/Chat Stream",
  parameters: { layout: "centered" },
}
export default meta

type Story = StoryObj<typeof chatStreamDefaultProps>

export const Player: Story = {
  args: chatStreamDefaultProps,
  render: (args) => (
    <PlayerStage
      component={ChatStream}
      inputProps={args}
      durationInFrames={CHAT_STREAM_DURATION_IN_FRAMES}
      fps={CHAT_STREAM_FPS}
      compositionWidth={CHAT_STREAM_WIDTH}
      compositionHeight={CHAT_STREAM_HEIGHT}
      displayWidth={1280}
    />
  ),
}

export const Codex: Story = {
  args: { ...chatStreamDefaultProps, harness: "codex", brandHue: HARNESS_CODEX_HUE },
  render: (args) => (
    <PlayerStage
      component={ChatStream}
      inputProps={args}
      durationInFrames={CHAT_STREAM_DURATION_IN_FRAMES}
      fps={CHAT_STREAM_FPS}
      compositionWidth={CHAT_STREAM_WIDTH}
      compositionHeight={CHAT_STREAM_HEIGHT}
      displayWidth={1280}
    />
  ),
}

export const FastTyping: Story = {
  args: { ...chatStreamDefaultProps, typingCps: 200 },
  render: (args) => (
    <PlayerStage
      component={ChatStream}
      inputProps={args}
      durationInFrames={CHAT_STREAM_DURATION_IN_FRAMES}
      fps={CHAT_STREAM_FPS}
      compositionWidth={CHAT_STREAM_WIDTH}
      compositionHeight={CHAT_STREAM_HEIGHT}
      displayWidth={1280}
      autoPlay
    />
  ),
}

export const Dark: Story = {
  args: { ...chatStreamDefaultProps, darkMode: true },
  render: (args) => (
    <PlayerStage
      component={ChatStream}
      inputProps={args}
      durationInFrames={CHAT_STREAM_DURATION_IN_FRAMES}
      fps={CHAT_STREAM_FPS}
      compositionWidth={CHAT_STREAM_WIDTH}
      compositionHeight={CHAT_STREAM_HEIGHT}
      displayWidth={1280}
      background="#1c1917"
    />
  ),
}
