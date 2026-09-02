import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CodexConversationViewToggleMock,
  CodexRealtimeTimelineMock,
  CodexRealtimeVoiceButtonMock,
  DEFAULT_REALTIME_TIMELINE_SEGMENTS,
  RealtimeVoiceMock,
  type RealtimeVoiceState,
} from "./realtime-voice-mock";

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
    defaultVoiceState: {
      control: "inline-radio",
      options: ["idle", "starting", "active", "stopping"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof RealtimeVoiceMock>;

/** Click the round voice button to enter the timeline, then use the header action to switch views. */
export const Interactive: Story = {};

export const TimelineHistory: Story = {
  args: {
    defaultView: "realtime",
  },
};

export const ActiveCall: Story = {
  args: {
    defaultView: "realtime",
    defaultVoiceState: "active",
    speakingSegmentIds: ["call-2-assistant-1"],
  },
};

export const EmptyActiveCall: Story = {
  args: {
    defaultView: "realtime",
    defaultVoiceState: "active",
    hasTimeline: false,
    segments: [],
  },
};

const VOICE_STATES: readonly RealtimeVoiceState[] = [
  "idle",
  "starting",
  "active",
  "stopping",
];

export const VoiceButtonStates: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-6 rounded-xl border border-border bg-card p-6">
      {VOICE_STATES.map((state) => (
        <div key={state} className="flex flex-col items-center gap-2">
          <CodexRealtimeVoiceButtonMock state={state} />
          <span className="text-xs text-muted-foreground">{state}</span>
        </div>
      ))}
    </div>
  ),
};

export const ConversationViewToggle: Story = {
  render: () => (
    <div className="flex items-center gap-6 rounded-xl border border-border bg-card p-6">
      <div className="flex flex-col items-center gap-2">
        <CodexConversationViewToggleMock view="thread" />
        <span className="text-xs text-muted-foreground">thread</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <CodexConversationViewToggleMock view="realtime" />
        <span className="text-xs text-muted-foreground">realtime</span>
      </div>
    </div>
  ),
};

export const TimelineOnly: Story = {
  render: () => (
    <div className="rounded-xl border border-border bg-background p-4">
      <CodexRealtimeTimelineMock
        segments={DEFAULT_REALTIME_TIMELINE_SEGMENTS}
        speakingSegmentIds={["call-2-assistant-1"]}
      />
    </div>
  ),
};
