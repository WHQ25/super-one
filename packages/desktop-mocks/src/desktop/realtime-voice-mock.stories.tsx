import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  CodexConversationViewToggleMock,
  CodexRealtimeVoiceButtonMock,
  RealtimeCallIndicatorMock,
  RealtimeVoiceMock,
  type RealtimeVoiceState,
} from "./realtime-voice-mock"

const meta: Meta<typeof RealtimeVoiceMock> = {
  title: "Desktop Mocks/RealtimeVoice",
  component: RealtimeVoiceMock,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ width: 760, maxWidth: "100%" }}>
        <Story />
      </div>
    ),
  ],
  argTypes: {
    view: { control: "inline-radio", options: ["thread", "realtime"] },
    defaultView: { control: "inline-radio", options: ["thread", "realtime"] },
    voiceState: {
      control: "inline-radio",
      options: ["idle", "starting", "active", "stopping"],
    },
    activity: {
      control: "inline-radio",
      options: ["listening", "user-speaking", "assistant-speaking", "thinking"],
    },
  },
}

export default meta
type Story = StoryObj<typeof RealtimeVoiceMock>

/** Mid-call: spoken turns in the ordinary thread, assistant caption beside the cloud. */
export const ActiveCall: Story = {}

export const UserSpeaking: Story = {
  args: {
    activity: "user-speaking",
    captions: { user: "Then wire the renderer to the new event stream and…" },
  },
}

export const Listening: Story = {
  args: { activity: "listening", captions: {} },
}

/** The same session with the call ended — plain Codex thread, voice button idle. */
export const CallEnded: Story = {
  args: { defaultVoiceState: "idle" },
}

/** The backing Codex thread the header toggle switches to. */
export const DebugThread: Story = {
  args: { defaultView: "thread" },
}

export const EmptyActiveCall: Story = {
  args: { turns: [], hasTimeline: false },
}

export const CallIndicatorStates: Story = {
  render: () => (
    <div className="flex flex-col gap-6 rounded-xl border border-border bg-card p-4">
      <RealtimeCallIndicatorMock activity="listening" />
      <RealtimeCallIndicatorMock
        activity="user-speaking"
        captions={{ user: "Start with the handoff between the runtime and the renderer." }}
      />
      <RealtimeCallIndicatorMock
        activity="assistant-speaking"
        captions={{ assistant: "The runtime publishes normalized events; the renderer only derives presentation state." }}
      />
      <RealtimeCallIndicatorMock activity="thinking" />
    </div>
  ),
}

export const VoiceButtonStates: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {(["idle", "starting", "active", "stopping"] as RealtimeVoiceState[]).map((state) => (
        <div key={state} className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
          <CodexRealtimeVoiceButtonMock state={state} />
          <span>{state}</span>
        </div>
      ))}
    </div>
  ),
}

export const ConversationViewToggle: Story = {
  render: () => (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <CodexConversationViewToggleMock view="realtime" />
      <CodexConversationViewToggleMock view="thread" />
    </div>
  ),
}
