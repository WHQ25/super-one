import type { Meta, StoryObj } from "@storybook/react-vite"
import { Activity, Check, Gauge, Sparkles } from "lucide-react"
import { TurnDetailMock, type TurnDetailRunMock } from "./turn-detail-mock"

const meta: Meta<typeof TurnDetailMock> = {
  title: "Desktop Mocks/TurnDetailMock",
  component: TurnDetailMock,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ width: 760 }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof TurnDetailMock>

export const CompletedCollapsed: Story = {}

export const CompletedExpanded: Story = {
  args: { expanded: true },
}

const INTERLEAVED_RUNS: TurnDetailRunMock[] = [
  {
    id: "lead",
    type: "markdown",
    text: "I split the work into implementation and visual verification.",
  },
  {
    id: "thinking-1",
    type: "thinking",
    text: "First verify the component contract, then keep the rendering change isolated to the mock package.",
  },
  {
    id: "grep",
    type: "tool",
    spec: {
      variant: "grep",
      pattern: "TurnDetailSection",
      path: "apps/desktop/src/renderer/src/components/chat",
      matches: "TurnDetailSection.tsx:114\nChatMessage.tsx:894\nCodexTurnView.tsx:575",
    },
  },
  {
    id: "widget",
    type: "widget",
    node: (
      <div className="my-2 rounded-lg border border-border/60 bg-card p-3 shadow-sm">
        <div className="flex items-center gap-2 text-xs">
          <Gauge className="size-3.5 text-primary" />
          <span className="font-medium">Runtime health</span>
          <span className="ml-auto inline-flex items-center gap-1 text-success">
            <Check className="size-3" />
            Healthy
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded bg-muted/50 px-2 py-2">
            <Activity className="mx-auto mb-1 size-3 text-muted-foreground" />
            <div className="font-medium tabular-nums">18 ms</div>
            <div className="text-muted-foreground">render</div>
          </div>
          <div className="rounded bg-muted/50 px-2 py-2">
            <Sparkles className="mx-auto mb-1 size-3 text-muted-foreground" />
            <div className="font-medium tabular-nums">0</div>
            <div className="text-muted-foreground">warnings</div>
          </div>
          <div className="rounded bg-muted/50 px-2 py-2">
            <Check className="mx-auto mb-1 size-3 text-muted-foreground" />
            <div className="font-medium tabular-nums">12/12</div>
            <div className="text-muted-foreground">checks</div>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "process",
    type: "process",
    label: "Visual verification",
    summary: "Storybook canvas · compact and expanded states",
    status: "complete",
  },
  {
    id: "answer",
    type: "markdown",
    text: "The widget stays pinned between hidden process runs. Expanding Details restores the original sequence around it.",
  },
]

export const PinnedContentKeepsOrder: Story = {
  args: {
    runs: INTERLEAVED_RUNS,
    stats: { toolCalls: 2, filesChanged: 1, added: 64, removed: 12 },
  },
}

export const NarrowConversation: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 420 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    stats: { toolCalls: 12, filesChanged: 8, added: 1240, removed: 318 },
  },
}
